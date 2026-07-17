# mnd

Personal CLI tool for AI-assisted video vlog editing. Automates transcription, pause/filler removal, b-roll placement, music selection, and thumbnail generation. Exports to DaVinci Resolve via `.fcpxml`.

## Requirements

- Node.js ≥ 20
- pnpm
- FFmpeg in PATH
- Python 3.10+ (for sidecar: `pip install -r sidecar/requirements.txt`)
- Groq API key (for `hybrid` profile) — set via `mnd config`
- Ollama running locally (for `local` profile)

## Quick Start

```bash
pnpm install
pnpm build
node dist/index.js
```

## Config

Config file: `~/.config/mnd/config.yaml`  
API keys: stored in system keychain (never in config file)

## Commands

| Command | Description |
|---|---|
| `config` | Full-screen config editor |
| `open "Name"` | Open existing project |
| `create "Name"` | Create new project |
| `sort` | Sort inbox files into Assets/raw |
| `analyze` | Run full AI pipeline |
| `prompt "text"` | Edit the current plan via AI |
| `approve` | Export final .fcpxml |
| `fix "error"` | Record a rule from a mistake |
| `show history` | List all projects |
| `full new` | Verbose pipeline run |
| `full show` | Re-display last report |
| `thumbnail --full\|--layers` | Generate thumbnail |
| `refactor "rule"` | Refactor an existing rule |
| `rules review` | Check for rule conflicts |
| `status` | Show service statuses |

## Architecture

- **REPL**: Custom router with Levenshtein fuzzy matching
- **Profiles**: `hybrid` (Groq cloud) / `local` (Ollama)
- **Persistent processes**: Antigravity CLI + Python sidecar via FIFO queue
- **Vault**: Obsidian-compatible markdown files with YAML frontmatter
- **Export**: `.fcpxml` via OpenTimelineIO (Python sidecar)
