# MND — AI-монтаж из папки в DaVinci Resolve

MND сканирует папку с исходниками, анализирует реальное видео и аудио, получает монтажные решения от **Antigravity CLI (`agy`)**, детерминированно проверяет их и создаёт `final-timeline.fcpxml`. Этот файл импортируется в DaVinci Resolve как готовая timeline с исходниками online; финальный кодек и render выбираются уже на странице Deliver.

Тот же запуск просит Antigravity подготовить название, описание, теги и выбрать лучший исходник с таймкодом для превью. MND проверяет выбор и извлекает реальный кадр через встроенный FFmpeg в `thumbnail.jpg`.

В репозитории два интерфейса одной системы:

- MND CLI — основной терминальный интерфейс со slash-командами и JSON-режимом;
- MND Graph — desktop-интерфейс для открытия папки, графа файлов, выбора модели, ввода задания и запуска полного монтажа.

> Важно: **Antigravity CLI и desktop-приложение Antigravity — разные программы.** MND вызывает только официальный терминальный клиент `agy` из [`google-antigravity/antigravity-cli`](https://github.com/google-antigravity/antigravity-cli). Desktop Antigravity не используется и не изменяется.

## Что получается на выходе

```text
Projects/<project>/exports/MND_Export/
├── final-timeline.fcpxml       # импортировать в DaVinci Resolve
├── subtitles.srt
├── thumbnail.jpg               # 1280×720, кадр выбран Antigravity
├── title.txt
├── description.txt
├── publish.json                # структурированный пакет публикации
├── PUBLISH_PACKAGE.md          # название, описание, теги и выбор превью
├── source-manifest.json
├── transcript.json
├── scenes.json
├── edit-plan.json
├── compiled-timeline.json
├── validation-report.json
├── export-report.json
├── Assets/
└── README_IMPORT.txt
```

Это не MP4. FCPXML сохраняет монтаж редактируемым: клипы, дорожки, тайминг, переходы, титры, уровни звука и ссылки на исходные media.

## Требования

- Windows 10/11;
- Node.js 20 или новее;
- npm (или pnpm);
- Python 3.10+ для локальной транскрибации;
- Rust stable и Microsoft C++ Build Tools — только для сборки MND Graph из исходников;
- DaVinci Resolve — только для открытия готового FCPXML;
- Obsidian — необязателен, но MND умеет зарегистрировать и открыть vault.

FFmpeg и FFprobe поставляются npm-зависимостями. Большие модели локальной транскрибации могут скачать дополнительные файлы при первом запуске.

## 1. Установка Antigravity CLI

Откройте обычный PowerShell и выполните официальную команду:

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```

Закройте и заново откройте терминал, затем проверьте:

```powershell
agy --version
agy models
agy --print "Reply with exactly: OK" --print-timeout 30s --model "Gemini 3.5 Flash (Low)"
```

Типичный путь Windows:

```text
%LOCALAPPDATA%\agy\bin\agy.exe
```

Если `agy` скачан, но команда не находится, исправьте пользовательский PATH:

```powershell
$agyBin = Join-Path $env:LOCALAPPDATA 'agy\bin'
[Environment]::SetEnvironmentVariable('Path', $agyBin, 'User')
$env:Path = "$agyBin;$env:Path"
agy --version
```

В PATH должен храниться сам путь, а не буквальный текст вроде `[Environment]::GetEnvironmentVariable(...)`. Альтернативно можно указать executable только для MND:

```powershell
$env:AGY_CLI_PATH = "$env:LOCALAPPDATA\agy\bin\agy.exe"
```

Доступные модели всегда берутся из живого `agy models`; список не зашит в MND. На момент проверки CLI 1.1.4 возвращал Gemini 3.5 Flash, Gemini 3.1 Pro, Claude Sonnet/Opus 4.6 и GPT-OSS 120B в разных режимах reasoning.

Google-аутентификацию в MND на этом этапе настраивать не нужно. Сам `agy` использует собственную уже настроенную сессию. Команды MND `/login`, `/logout`, `/account` и Google Drive не участвуют в автоматическом монтаже.

## 2. Установка MND из исходников

```powershell
git clone https://github.com/waters1ze/mnd.git
cd mnd
npm install
python -m pip install -r sidecar\requirements.txt
npm run build
```

Запуск интерактивного CLI:

```powershell
node dist\index.js
```

Одноразовая команда без REPL:

```powershell
node dist\index.js doctor --full
```

Для глобальной команды в рабочей копии:

```powershell
npm link
mnd --help
```

Конфигурация хранится в пользовательском каталоге MND, секреты — отдельно в системном keyring. API-ключи не записываются в проект или обычный backup.

## 3. Самый короткий путь: папка → готовый монтаж

```powershell
node dist\index.js auto `
  --folder "D:\Footage\My video" `
  --prompt "Собери динамичный ролик на 60–90 секунд, убери длинные паузы и повторы, сохрани связную речь, добавляй B-roll только между смысловыми блоками" `
  --model "Gemini 3.5 Flash (Medium)" `
  --name "My automatic edit" `
  --target-duration 75 `
  --aspect 16:9 `
  --fps 25 `
  --pacing fast `
  --broll medium
```

MND рекурсивно найдёт поддерживаемые video/audio/image, исключит `.git`, `.mnd`, `.obsidian`, `node_modules`, `Projects` и `Exports`, затем:

1. создаст проект и безопасно скопирует исходники в `sources/`;
2. выполнит streamed SHA-256 и FFprobe;
3. получит transcript, сцены и диагностику;
4. построит baseline edit plan;
5. передаст ограниченный JSON-контекст выбранной модели через `agy --print --mode plan`;
6. отклонит неизвестные source ID, выход за границы, пересечения, неверный FPS или неподдерживаемые эффекты;
7. соберёт и повторно проверит FCPXML;
8. вторым проверенным запросом попросит Antigravity создать название, описание, теги и выбрать кадр;
9. проверит source ID и таймкод, затем создаст `thumbnail.jpg` через FFmpeg.

### Изображения по фразе из видео

Положите PNG/JPEG/WebP вместе с исходниками и назовите файл понятно, например `link-card.png`. Имя можно указать прямо в задании:

```text
Когда я говорю «ссылка находится в описании» и показываю вниз,
вставь link-card.png между моих рук на 2–3 секунды.
```

MND сопоставит имя файла с manifest, найдёт реплику в транскрипте, защитит этот фрагмент от вырезания и добавит изображение отдельным connected overlay. Формулировки «между рук» и «показываю вниз» используют компактное размещение по центру ниже лица; `слева`, `справа` и `на весь экран` меняют transform. Если имя не указано, выбирается первое изображение в стабильном порядке. Без явной просьбы изображения сами в timeline не добавляются.

Это позиционирование по смыслу и композиционному шаблону, а не покадровый трекинг кистей: если руки двигаются по кадру, точный motion tracking пока нужно поправить в Resolve.

Для машинной интеграции добавьте `--json`. В этом режиме progress не смешивается с JSON, ошибки имеют `status`, `error.code`, `error.message` и ненулевой exit code.

### Все флаги `/auto`

| Флаг | Значение |
|---|---|
| `--folder <path>` | папка исходников; по умолчанию активный vault |
| `--prompt <text>` | обязательное монтажное задание |
| `--model <name>` | точное имя из `agy models` |
| `--name <name>` | имя проекта/timeline |
| `--profile <type>` | `vlog`, `talking_head`, `tutorial`, `interview`, `short_vertical`, `documentary`, `cinematic`, `custom` |
| `--target-duration <sec>` | целевая длительность больше нуля |
| `--aspect <ratio>` | `16:9`, `9:16`, `1:1`, `4:5` |
| `--fps <value>` | целое `25` или рациональное `30000/1001` |
| `--pacing <value>` | `slow`, `balanced`, `fast` |
| `--broll <value>` | `none`, `low`, `medium`, `high` |
| `--music-level <dB>` | от `-96` до `12` |
| `--deterministic` | не вызывать AI, оставить deterministic baseline |
| `--json` | один JSON-объект на результат операции |

## 4. MND Graph

Разработка:

```powershell
npm run build
npm -w apps/mnd-graph run dev
```

Native desktop:

```powershell
npm run graph:tauri:build
```

После запуска:

1. нажмите **«Открыть папку»**;
2. выберите пустую папку, Obsidian vault или обычную папку с медиа;
3. подтвердите только показанный набор создаваемых служебных файлов;
4. дождитесь полного рекурсивного индекса — Graph показывает Markdown, видео, аудио, изображения, subtitle, JSON/XML/FCPXML и связи заметок;
5. в правой панели **AI-монтажная** выберите модель из живого `agy models`;
6. задайте имя и подробно опишите результат;
7. нажмите **«Создать монтаж»**;
8. после зелёного статуса откройте `final-timeline.fcpxml`, `thumbnail.jpg` или пакет с названием и описанием прямо из панели результата.

MND Graph не удаляет и не перезаписывает пользовательские заметки при подключении папки, не следует по symlink и хранит служебный индекс в `.mnd/`.

## 5. Импорт в DaVinci Resolve

1. Откройте нужную Project Library и проект.
2. Выберите **File → Import → Timeline**.
3. Укажите `final-timeline.fcpxml`.
4. Проверьте timeline и media pool.
5. Если исходники перемещались после экспорта, выполните Relink Selected Clips.
6. Перейдите в Deliver и выберите контейнер, кодек, разрешение и качество.

Проверка MND гарантирует валидный XML, рациональный FPS/timebase, существующие media URI, актуальные hashes и допустимые source ranges. Сам импорт в конкретную установленную версию DaVinci остаётся отдельной проверкой среды.

## 6. Obsidian

```text
/obsidian setup       # подготовить vault с подтверждением
/obsidian open        # открыть vault в Obsidian
/obsidian repair      # восстановить отсутствующую структуру без удаления заметок
/obsidian status      # проверить структуру и регистрацию
/obsidian reset       # только явный reset flow с подтверждением
```

Обычная команда `/obsidian` теперь всегда ведёт в конкретный MND-проект: открывает активный `Projects/<slug>/project.md`, при отсутствии активного проекта выбирает последний изменённый, а в пустом vault создаёт первый проект и сразу открывает его. После команды интерактивный MND продолжает работать.

Кнопка **«Открыть vault в Obsidian»** в MND Graph выполняет тот же безопасный open. Существующие `.obsidian`, `.base`, Markdown, attachments и неизвестные пользовательские файлы сохраняются.

### Управление интерактивным терминалом

- `/` открывает палитру команд;
- `↑` и `↓` листают историю;
- `Esc` очищает ввод или закрывает палитру, но не завершает MND;
- `Ctrl+C` и `Ctrl+D` очищают текущий ввод, но не завершают MND;
- только отдельная команда `exit` или `quit` завершает интерактивную программу.

## 7. Команды CLI

В интерактивном режиме допустимы варианты с `/` и без него.

| Команда | Назначение и основные аргументы |
|---|---|
| `/help` | краткая справка |
| `/config` | профиль, соединения и выбор Antigravity conversation model |
| `/status` | состояние текущей сессии и сервисов |
| `/doctor [--quick|--full] [--json] [--no-network] [--fix] [--project <slug>]` | диагностика runtime, `agy`, vault, sidecar, media и проекта |
| `/create <name>` | создать проект и стабильный project ID |
| `/open <name-or-slug>` | открыть проект |
| `/project [slug]` | метаданные и пути проекта |
| `/add <file-or-directory> [--project <slug>]` | импорт media с проверкой path boundary и конфликтов |
| `/analyze [--project <slug>] [--skip-transcribe]` | manifest, transcript, сцены и media diagnostics |
| `/transcribe [source-id] [--project <slug>]` | timestamped transcript |
| `/scenes [--project <slug>]` | список сцен и scores |
| `/edit plan [flags]` | создать и проверить EditPlan |
| `/edit validate [--project <slug>]` | deterministic validation |
| `/edit build [--project <slug>]` | compiled multitrack timeline |
| `/edit status [--project <slug>]` | статус плана и build |
| `/export resolve [--project <slug>]` | создать FCPXML bundle без замены существующего результата |
| `/export retry [--project <slug>]` | пересобрать с backup предыдущего результата |
| `/export validate [--project <slug>]` | повторная проверка FCPXML и media |
| `/export reveal [--project <slug>]` | показать FCPXML в Explorer без shell interpolation |
| `/auto ...` | полный workflow из одной команды |
| `/prompt <text>` | уточнить текущий legacy plan выбранной conversation model |
| `/approve` | совместимый alias для export resolve |
| `/fix <description>` | записать правило из исправления |
| `/refactor <rule>` | переработать правило |
| `/rules review` | проверить конфликты правил |
| `/show history` | история проектов |
| `/sort` | разобрать inbox |
| `/full new`, `/full show` | полный legacy pipeline и последний отчёт |
| `/thumbnail --full|--layers` | устаревший отдельный flow; основной `/auto` сам создаёт проверенное превью из реального кадра |
| `/backup project|config [--name <label>]`, `/backups` | backup без OAuth/API secrets |
| `/restore project|config <backup-id>` | восстановление с проверкой границ |
| `/logs` | журналы операций |
| `/graph [current|all|node <id>|rebuild|status]` | открыть/управлять MND Graph, если native executable установлен |
| `/login`, `/logout`, `/account` | Google account; не требуется для основного workflow |
| `/sync ...` | выборочная синхронизация Google Drive; не требуется для основного workflow |
| `/update ...` | проверяемое обновление/rollback |

### Флаги `/edit plan`

`--project`, `--provider antigravity|groq`, `--model`, `--instruction`, `--profile`, `--target-duration`, `--aspect`, `--fps`, `--pacing`, `--broll`, `--music-level`, `--protect sourceId:start-end,...`, `--ban sourceId:start-end,...`, `--name`, `--deterministic`.

Глобальные `--json` и переменная `MND_JSON=1` включают структурированный вывод. `MND_VAULT_PATH`, `MND_APP_DATA`, `AGY_CLI_PATH`, `MND_NODE_PATH` и `MND_CLI_ENTRY` предназначены для явного запуска/интеграции и имеют приоритет над auto-discovery. `MND_APP_DATA` меняет только каталог MND и, в отличие от подмены `LOCALAPPDATA`, не скрывает keyring/session самого `agy`.

## 8. Поддерживаемые исходники

- видео: MP4, MOV, MKV, WebM, AVI, MXF, M4V, 3GP;
- аудио: MP3, WAV, M4A, FLAC, OGG, Opus, AAC, AIFF;
- изображения: PNG, JPEG, GIF, WebP, BMP, TIFF, HEIC.

Одинаковые имена не перезаписывают друг друга: конфликтующий файл получает suffix из SHA-256. Изменение исходника после анализа обнаруживается до build/export.

## 9. Диагностика

```powershell
node dist\index.js doctor --full
node dist\index.js doctor --json --no-network
node dist\index.js doctor --fix
```

Частые проблемы:

- **`agy` не найден** — выполните PATH-инструкцию выше, перезапустите терминал, проверьте `where.exe agy`;
- **модели пусты** — выполните `agy models` напрямую и завершите настройку самого CLI;
- **`No supported media files`** — проверьте расширение и что файлы не лежат в исключённой служебной папке;
- **транскрибация не стартует** — установите `sidecar/requirements.txt` или настройте Groq transcription profile;
- **FCPXML уже существует** — используйте `/export retry`; MND не уничтожает результат молча;
- **media offline в Resolve** — исходники были перемещены после экспорта; верните их или выполните Relink;
- **Obsidian не найден** — Graph всё равно работает как vault/browser; кнопка открытия потребует установленный Obsidian.

## 10. Проверки разработчика

```powershell
npm run build
npm run lint
npm test -- --runInBand
npm run release:verify
npm run graph:lint
npm run graph:typecheck
npm run graph:test
npm run graph:e2e
npm run graph:verify

cd apps\mnd-graph\src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo check
cd ..\..\..

npm run graph:tauri:build
```

## Ограничения

- Новый `agy` проверенно предоставляет chat/agent orchestration, выбор модели, plan mode и workspace directories, но не документирует контракт возврата сгенерированного image-файла. Поэтому `/auto` использует Antigravity для творческого выбора source ID, таймкода, headline, названия и описания, а сам проверенный JPEG извлекает из реального исходника встроенным FFmpeg.
- Google OAuth/Drive остаётся отдельной необязательной интеграцией и не настраивается автоматически.
- MND создаёт и валидирует FCPXML, но не нажимает Render и не выбирает кодек за пользователя.
- Качество AI-монтажа зависит от исходников, transcript и точности prompt; любые ответы AI проходят детерминированную проверку, но творческое решение всё равно стоит просмотреть перед render.

## Лицензия и безопасность

Не передавайте MND папки, к которым процесс не должен иметь доступ. AI получает структурированное описание media и ограниченный workspace, не shell-команды. Дочерние процессы запускаются с `shell: false`; symlink и path escape отклоняются. Перед публикацией проекта проверьте лицензии на музыку, изображения, шрифты и исходное видео.
