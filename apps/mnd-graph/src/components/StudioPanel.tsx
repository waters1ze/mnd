import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getAntigravityInfo,
  openVaultInObsidian,
  revealVaultEntry,
  runAutoEdit,
  scanVaultInventory,
  type AntigravityInfo,
  type AutoEditResult,
  type VaultInventory,
} from '../core/ipc';
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  Film,
  FolderSearch2,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';

const progressMessages = [
  'Импортируем медиа и считаем контрольные суммы',
  'Анализируем звук, речь, паузы и сцены',
  'Antigravity составляет монтажный план',
  'Проверяем границы клипов и собираем timeline',
  'Формируем FCPXML-пакет для DaVinci Resolve',
];

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function StudioPanel({ vaultId }: { vaultId: string }) {
  const [antigravity, setAntigravity] = useState<AntigravityInfo | null>(null);
  const [inventory, setInventory] = useState<VaultInventory | null>(null);
  const [model, setModel] = useState('');
  const [projectName, setProjectName] = useState('Мой автоматический монтаж');
  const [prompt, setPrompt] = useState('');
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [running, setRunning] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutoEditResult | null>(null);

  const refresh = useCallback(async () => {
    setLoadingInventory(true);
    setError(null);
    try {
      const [info, scanned] = await Promise.all([getAntigravityInfo(), scanVaultInventory(vaultId)]);
      setAntigravity(info);
      setInventory(scanned);
      setModel(current => current || info.models.find(item => item.includes('Gemini 3.5 Flash (Medium)')) || info.models[0] || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingInventory(false);
    }
  }, [vaultId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setProgressIndex(index => Math.min(index + 1, progressMessages.length - 1)), 12_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const canRun = antigravity?.status === 'ready' && inventory && inventory.mediaFiles > 0 && model && prompt.trim().length >= 8 && !running;
  const mediaSummary = useMemo(() => {
    if (!inventory) return 'Сканирование…';
    return `${inventory.mediaFiles} медиа • ${inventory.totalFiles} файлов • ${formatBytes(inventory.totalBytes)}`;
  }, [inventory]);

  const start = async () => {
    if (!canRun) return;
    setRunning(true);
    setProgressIndex(0);
    setError(null);
    setResult(null);
    try {
      const completed = await runAutoEdit(vaultId, prompt.trim(), model, projectName.trim() || 'MND Auto Edit');
      setResult(completed);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };

  return (
    <aside className="studio-panel w-[390px] shrink-0 border-l border-white/8 bg-[#090b12]/95 backdrop-blur-2xl flex flex-col overflow-hidden">
      <div className="px-5 py-5 border-b border-white/8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-violet-300 text-xs font-semibold uppercase tracking-[0.18em]">
              <Sparkles className="w-3.5 h-3.5" /> AI монтажная
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white tracking-tight">От папки до DaVinci</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">MND анализирует материалы, Antigravity принимает монтажные решения, валидатор собирает FCPXML.</p>
          </div>
          <button aria-label="Пересканировать папку" onClick={() => void refresh()} disabled={loadingInventory || running} className="icon-button">
            <RefreshCw className={`w-4 h-4 ${loadingInventory ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 space-y-5">
        <section className="glass-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="status-icon bg-cyan-400/10 text-cyan-300"><FolderSearch2 className="w-4 h-4" /></div>
              <div>
                <p className="text-sm font-medium text-slate-100">Материалы</p>
                <p className="text-[11px] text-slate-500">Полный рекурсивный scan</p>
              </div>
            </div>
            {loadingInventory ? <Loader2 className="w-4 h-4 animate-spin text-cyan-300" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </div>
          <p className="mt-3 text-xs text-slate-300 tabular-nums">{mediaSummary}</p>
          {inventory && inventory.mediaFiles === 0 && <p className="mt-2 text-xs text-amber-300">Добавьте видео, аудио или изображения в открытую папку.</p>}
        </section>

        <section className="glass-card p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="status-icon bg-violet-400/10 text-violet-300"><Bot className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">Antigravity CLI</p>
              <p className="truncate text-[11px] text-slate-500">{antigravity?.version ? `agy ${antigravity.version}` : 'Проверка установки'}</p>
            </div>
            <span className={`status-pill ${antigravity?.status === 'ready' ? 'status-ready' : 'status-error'}`}>{antigravity?.status === 'ready' ? 'Ready' : 'Offline'}</span>
          </div>
          <label className="field-label" htmlFor="model-select">Модель для разговора и монтажа</label>
          <select id="model-select" value={model} onChange={event => setModel(event.target.value)} disabled={running || antigravity?.status !== 'ready'} className="field-control">
            {(antigravity?.models ?? []).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </section>

        <section className="space-y-3">
          <div>
            <label className="field-label" htmlFor="project-name">Название проекта</label>
            <input id="project-name" value={projectName} onChange={event => setProjectName(event.target.value)} disabled={running} className="field-control" />
          </div>
          <div>
            <label className="field-label" htmlFor="edit-prompt">Что должно получиться</label>
            <textarea id="edit-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} disabled={running} rows={7} className="field-control resize-none leading-relaxed" placeholder="Например: собери динамичный ролик на 60–90 секунд, убери длинные паузы и повторы, оставь связную речь, используй B-roll между смысловыми блоками…" />
            <p className="mt-1.5 text-[11px] text-slate-500">Чем конкретнее цель, длительность и темп, тем точнее монтажный план.</p>
          </div>
        </section>

        {running && (
          <section className="glass-card p-4" aria-live="polite">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-violet-300" />
              <div>
                <p className="text-sm font-medium text-white">Монтаж выполняется</p>
                <p className="text-xs text-slate-400">{progressMessages[progressIndex]}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-1.5">
              {progressMessages.map((_, index) => <div key={index} className={`h-1 rounded-full ${index <= progressIndex ? 'bg-gradient-to-r from-cyan-400 to-violet-400' : 'bg-white/8'}`} />)}
            </div>
          </section>
        )}

        {error && (
          <section className="rounded-2xl border border-rose-400/20 bg-rose-500/8 p-4 text-rose-200">
            <div className="flex items-start gap-2.5"><TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" /><p className="text-xs leading-relaxed break-words">{error}</p></div>
          </section>
        )}

        {result && (
          <section className="rounded-2xl border border-emerald-400/20 bg-emerald-500/8 p-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="w-5 h-5" /><p className="text-sm font-semibold">Монтаж готов</p></div>
            <p className="text-xs leading-relaxed text-slate-300">FCPXML проверен. Импортируйте его в DaVinci Resolve — исходники останутся online.</p>
            <p className="text-[11px] font-mono text-slate-500 break-all">{result.fcpxmlPath}</p>
            <button onClick={() => result.fcpxmlRelativePath && revealVaultEntry(vaultId, result.fcpxmlRelativePath)} disabled={!result.fcpxmlRelativePath} className="secondary-button w-full"><ExternalLink className="w-4 h-4" /> Показать FCPXML</button>
          </section>
        )}
      </div>

      <div className="p-5 border-t border-white/8 space-y-2.5">
        <button onClick={() => void start()} disabled={!canRun} className="primary-button w-full">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
          {running ? 'MND монтирует…' : 'Создать монтаж'}
        </button>
        <button onClick={() => void openVaultInObsidian(vaultId)} disabled={running} className="secondary-button w-full">Открыть vault в Obsidian</button>
      </div>
    </aside>
  );
}
