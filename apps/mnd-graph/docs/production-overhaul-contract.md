# MND Graph Vault — Production Overhaul Contract

**Branch:** `feature/mnd-graph-vault`  
**Base checkpoint:** `1b2b196a68a4b6ef5039170229f9ac174732bcba`  
**Plan Status:** APPROVED FOR EXECUTION  

> This document is the binding implementation contract. The machine-readable fixtures live
> alongside it: `fixtures/expected-vault-structure.json`, `fixtures/contract-enums.json`,
> `release-manifest.json`, `release-manifest.schema.json`.
>
> **Do not claim production-ready or request merge until a new pushed SHA has been independently
> audited from GitHub production sources, tests, verifier, capabilities, Rust commands,
> reports and artifacts.**

---

## Agent Rules

- Work only on `feature/mnd-graph-vault`.
- Start from `1b2b196a68a4b6ef5039170229f9ac174732bcba`.
- Do not reduce scope.
- Do not change gate criteria mid-implementation to obtain PASS.
- Do not assign PASS from markers, test names, file existence, compilation, Cargo availability, or generic suites.
- Do not replace native evidence with browser mocks.
- Do not force-push.
- Do not merge into main.
- Allowed final report values: PASS, PARTIAL, NOT RUN, FAIL. Blanket PASS for G01-G20 is prohibited.

---

## Section 1 — Evidence and Verification

### 1.1 Evidence Manifest

Authoritative evidence items are defined in `release-manifest.json`. See `release-manifest.schema.json` for the full field spec.

Each evidence item specifies: `evidenceId`, `gate`, `command`, `workingDirectory`, `runner`, `expectedTestIds`, `requiredArtifacts`, `classification`, `timeout`, `mandatory`, `platform`.

Each execution record captured by the verifier must include:
`headSha`, `startedAt`, `finishedAt`, `exitCode`, `stdoutArtifact`, `stderrArtifact`, `reportArtifact`, `artifactHashes`.

### 1.2 Status Rules

For each gate, status is computed from mandatory evidence items:

| Outcome                                          | Gate Status |
|--------------------------------------------------|-------------|
| All mandatory evidence executed and passed       | PASS        |
| Some passed, some NOT RUN                        | PARTIAL     |
| Any executed evidence failed                     | FAIL        |
| Passing AND failing evidence both present        | FAIL (not PARTIAL) |
| No mandatory evidence executed                   | NOT RUN     |

Additional rules:
- Verifier deletes old report files before running.
- Reports with wrong `headSha` are rejected.
- Missing test ID → NOT RUN.
- Skipped test → NOT RUN.
- Failed test → FAIL.
- Web-only evidence on native gate → PARTIAL.
- One test ID cannot close multiple gates.
- Generic test title (e.g. `G01-G19 production works`) is prohibited.
- Source inspection is `classification: "source_audit"`, not a narrative.
- Verifier exits nonzero for any FAIL, PARTIAL, or required NOT RUN.

### 1.3 E2E Classification

Browser Playwright with mocked `invoke` = `browser_e2e`. Evidence description must say:
> "UI called the expected typed bridge contract"

Not: "Rust atomic write succeeded".

Valid classifications: `unit`, `web_component`, `browser_e2e`, `filesystem_integration`, `rust_native`, `tauri_native`, `manual`, `performance`, `source_audit`.

For a native gate to reach PASS, `rust_native` or `tauri_native` evidence must be present and passing.

### 1.4 Minimum Evidence per Gate

| Gate | Minimum required classification                                        |
|------|------------------------------------------------------------------------|
| G01  | `rust_native` + `tauri_native` (Windows mandatory)                     |
| G02  | `browser_e2e` + `rust_native`; native dialog = `tauri_native` or `manual` |
| G03  | `rust_native`                                                          |
| G04  | `rust_native` + `filesystem_integration`                               |
| G05  | `rust_native` + `filesystem_integration`                               |
| G06  | `rust_native` + `filesystem_integration`                               |
| G07  | `rust_native`                                                          |
| G08  | `rust_native`                                                          |
| G09  | `browser_e2e` + `rust_native`                                          |
| G10  | `browser_e2e`                                                          |
| G11  | `browser_e2e` + `rust_native`; media loading = `tauri_native` for full PASS |
| G12  | `browser_e2e` + `rust_native`/`filesystem_integration` per mutation   |
| G13  | `rust_native` + `browser_e2e`                                          |
| G14  | `rust_native`; Windows platform acceptance mandatory                   |
| G15  | `browser_e2e`                                                          |
| G16  | `rust_native` + `browser_e2e`; real dispatch = `tauri_native` or `manual` |
| G17  | `filesystem_integration`                                               |
| G18  | `unit` + `filesystem_integration`; packaged executable artifact        |
| G19  | `rust_native` + `filesystem_integration` + `browser_e2e`              |
| G20  | all classifications + artifact validation                              |

---

## Section 2 — Native IPC Architecture

### 2.1 Capabilities

Remove: `fs:default`, `shell:default`, `sql:default`  
Retain: `core:default`, `dialog:default`

### 2.2 Vault Identity Protocol

`vaultId` is an opaque backend-generated handle. Frontend never controls the vault root path.

- Frontend sends: `{ vaultId: OpaqueString, relativePath: String }`  
- Backend resolves canonical root from its own registry.  
- Stale vault IDs (post-switch) are rejected with a typed error.

### 2.3 Folder Picker Protocol

`select_vault_directory` triggers native dialog. Backend stores the canonical candidate path.  
Frontend receives only:

```json
{
  "candidateId": "opaque-selection-id",
  "displayPath": "D:\\Media\\My Vault",
  "displayName": "My Vault"
}
```

Subsequent operations accept only `candidateId`:

- `classify_vault_destination(candidateId)`
- `preview_vault_initialization(candidateId, mode)`  
  → returns `{ previewToken, createSet: string[] }`
- `initialize_vault(candidateId, previewToken)`

`previewToken` is backend-generated, linked to candidate path + exact create set, has expiration, invalidated if destination changes, verified immediately before mutation.

Frontend cannot call `initialize_vault` for a different absolute path.

### 2.4 Complete Narrow IPC Command List

**Vault & Config**
- `select_vault_directory`
- `classify_vault_destination(candidateId)`
- `preview_vault_initialization(candidateId, mode)` → `{ previewToken, createSet }`
- `initialize_vault(candidateId, previewToken)`
- `get_app_config`
- `set_active_vault(vaultId)`
- `forget_recent_vault(vaultId)`

**File Operations** (all: `vaultId` + `relativePath`)
- `read_vault_file`
- `atomic_write_vault_file` — see §4.1
- `list_vault_directory`
- `create_vault_entry`
- `rename_vault_entry`
- `move_vault_entry`
- `duplicate_vault_entry`
- `trash_vault_entry`
- `reveal_vault_entry`

**Index & Graph**
- `load_graph`
- `rebuild_vault_index`
- `replace_index` — accepts validated `IndexPayload`, no raw SQL
- `search_nodes`
- `load_backlinks`
- `load_diagnostics`
- `get_index_metadata`
- `load_graph_layout`
- `save_graph_layout`

**Watcher**
- `start_vault_watcher`
- `stop_vault_watcher`

**Copy & Obsidian**
- `preview_vault_copy` → `CopyManifest`
- `copy_vault_safely`
- `open_vault_in_obsidian` → typed `ObsidianOutcome`

**Prohibited:**
- `execute_operation`, `filesystem_command`, `run_sql`, `launch_path`, `open_external`
- Any command accepting absolute path from frontend
- Any command wrapping shell invocation

### 2.5 Path Security

See `fixtures/contract-enums.json → securityErrorReasons` for the full list.

All containment uses component-based canonicalization; string-prefix containment is banned.  
Checks happen immediately before mutation, not only at preview time.

---

## Section 3 — Vault Structure

Authoritative fixture: `fixtures/expected-vault-structure.json`.

The `expectedPaths` array is the exact required set on an empty directory after initialization:

```
Home.md
Projects/
Assets/
Images/
Audio/
B-Roll/
Thumbnails/
Transcripts/
Styles/
Global_Rules/
Templates/
Templates/Project.md
Templates/Source.md
Templates/Transcript.md
Templates/Scene.md
Templates/Edit Plan.md
Templates/Asset.md
Exports/
.mnd/
.mnd/vault.json
.mnd/graph-layout.json
.mnd/graph-index.sqlite
.mnd/cache/
.mnd/manifests/
.mnd/backups/
.obsidian/
```

Note: `Images/`, `Audio/`, `B-Roll/`, `Thumbnails/` are **top-level** directories, not nested under `Assets/`.

Not counted as violations: SQLite `-wal`/`-shm` during open connection; atomic temp files during operation; OS-generated metadata.  
After cleanup: no orphan temp files.

---

## Section 4 — File Safety

### 4.1 Atomic Write Algorithm

`atomic_write_vault_file` input: `{ vaultId, relativePath, content, baseIdentity?: { mtime, size, sha256 } }`

1. Resolve and validate path (§2.5).
2. If `baseIdentity` present: read current file; compute `mtime + size + sha256`. If any differs → return `external_change_conflict`.
3. Generate temp: `.<filename>.mnd-tmp-<pid>-<cryptographic-nonce>`.
4. Exclusive create (fail if exists).
5. Write all.
6. `flush()`.
7. `sync_all()`.
8. Windows: backup original to `.mnd/backups/<uuid>`.
9. Atomic rename/replace (Windows-safe).
10. Parent directory sync where supported.
11. Reread.
12. SHA-256 of reread content.
13. Verify matches written SHA-256.
14. Cleanup temp + backup.
15. On failure: cleanup temp, restore from backup, return typed error.

Injected-failure tests required at steps 4, 5, 6, 9, 11.

### 4.2 Conflict UI

Four required options: `Reload external`, `Compare`, `Save as copy`, `Cancel`.  
Silent overwrite is prohibited.

### 4.3 Trashing

Default: `trash_vault_entry` → `.mnd/backups/<trash-uuid>/` with recovery metadata (original path, timestamp, SHA-256).  
Permanent delete: separate explicitly-confirmed action only.

---

## Section 5 — App Config

Schema: `{ schemaVersion: number, activeVaultPath: string, recentVaults: Array<{ path, lastOpened }>, updatedAt: string }`.

Write via atomic write algorithm. Schema-validated before write. Deduplication of recent vaults. Reread verify. Rollback/restore on corruption. Frontend cannot choose storage location.

---

## Section 6 — Vault Switching

Lifecycle on switch:
1. Check dirty editor → prompt save/discard.
2. `stop_vault_watcher`.
3. Close SQLite.
4. Canonicalize new root.
5. Register new vault ID in backend registry.
6. Open/rebuild index.
7. Load layout.
8. `start_vault_watcher`.
9. Atomic update app config.
10. Invalidate old vault ID.

---

## Section 7 — Safe Copy

Staging is created as a unique sibling to the destination on the same filesystem:

```
<destination-parent>/.<destination-name>.mnd-copy-staging-<uuid>
```

Not inside `.mnd/` — cross-volume renames are not atomic.

Algorithm:
1. Verify source + destination parent.
2. Confirm destination is absent.
3. Create staging sibling.
4. Copy + verify per-file SHA-256.
5. Re-verify source manifest.
6. Re-confirm destination absent.
7. Rename staging → destination.
8. Verify destination.
9. Cleanup staging on any error.

If same-filesystem atomic rename is unavailable: return `atomic_finalization_unavailable`. Do not fall back silently. Gate is PARTIAL without a separately approved safe fallback algorithm.

---

## Section 8 — SQLite

Path: `<vault>/.mnd/graph-index.sqlite` (hardcoded in Rust).  
Tables: `nodes`, `edges`, `files`, `backlinks`, `unresolved_links`, `diagnostics`, `index_metadata`.

Requirements: ordered migrations; WAL mode; transactions + rollback; duplicate `mnd_id` → `diagnostics`; corruption recovery; deterministic rebuild; delete+rebuild = equivalent graph semantics; rebuild does not modify Markdown or `.base` files; SQLite is not the sole copy of user data.

---

## Section 9 — Watcher

Events include: type, path, sequence, timestamp.

Required behaviors: debounce, self-write suppression (fingerprint-based), atomic-burst filtering, overflow → full rescan, error recovery, rename correlation, conflict event for dirty notes. Stop before switch; start after switch. Watcher must not write to user files.

---

## Section 10 — Obsidian Bases Preservation

Find all `*.base` files anywhere in vault. Before/after SHA-256 sets must be identical across:
init, index rebuild, SQLite delete+rebuild, layout save, vault switch (source), safe copy.

Generation of `.base` files: NOT RUN (out of scope). Preservation: mandatory.

---

## Section 11 — Internal Viewers

Types: Markdown, image, video, audio, JSON, XML/FCPXML, transcript, unsupported binary.  
No arbitrary `file://` from frontend. Use scoped asset protocol or backend streaming.  
JSON: parse-error state; no embedded execution.  
XML: escaped text only; no script execution.  
Unsupported: warning + copy path + reveal; no OS default launch.  
MIME validated, not only extension.

---

## Section 12 — G20 Full Pipeline

Mandatory commands (Windows):

```
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo check
npm run tauri build
```

Plus: path traversal tests, capability audit (source_audit), shell-prohibition audit, performance benchmarks with numeric thresholds, artifact hash/size validation, `git status --short` after report generation (must be clean), evidence bound to exact headSha.

`cargo build --release` is additional, does not substitute for `npm run tauri build`.

### 12.1 Performance Thresholds

| Fixture       | Operation                    | Threshold             |
|---------------|------------------------------|-----------------------|
| 100 nodes     | Initial index                | < 500 ms              |
| 1,000 nodes   | Initial index                | < 2 s                 |
| 10,000 nodes  | Initial index                | < 15 s                |
| 1,000 nodes   | SQLite read                  | < 200 ms              |
| 10,000 nodes  | SQLite read                  | < 1 s                 |
| 1,000 nodes   | Search query                 | < 100 ms              |
| 10,000 nodes  | Graph render init            | < 5 s                 |
| 10,000 nodes  | No main-thread task post-mount | < 500 ms             |
| 10,000 nodes  | Search input response        | < 150 ms              |
| 10,000 nodes  | Filter application           | < 250 ms              |

Each benchmark record must include: OS, CPU, RAM, Node version, Rust version, build mode, fixture hash, iterations, warmup count, median, p95, peak memory.  
Run on release build, not dev server.

### 12.2 Source Audit Checks

Script must search for and record file + line + reason for:

- `child_process.exec` in production launcher path
- `execSync` in production launcher path
- `shell: true`
- `cmd.exe`, `/bin/sh`, `powershell`, `start`
- Tauri shell plugin usage
- Broad `fs:default`, `shell:default`, `sql:default` in capabilities
- Generic IPC command patterns
- Arbitrary absolute paths in IPC DTOs
- `file://` URL construction
- Unsafe HTML rendering
- `Math.random()` in identity or layout persistence

Presence of a match does not automatically mean violation; each is recorded with `file`, `line`, `finding`, `isFinding: bool`, `reason`.

### 12.3 Platform Policy

Windows native evidence is mandatory for this release target. Absence of Windows evidence cannot be justified by "platform unavailable". macOS/Linux gaps may be recorded as known limitations with `NOT RUN` status.

---

## Section 13 — CLI `/graph`

### Subcommand Contracts

| Command             | Behavior                                                           |
|---------------------|--------------------------------------------------------------------|
| `/graph`            | Opens configured/current vault GUI; `vault_not_configured` if none |
| `/graph current`    | Opens current vault GUI                                            |
| `/graph all`        | Opens vault selector/overview UI                                   |
| `/graph node <id>`  | Validates ID, launches/focuses app, sends typed open-node request  |
| `/graph rebuild`    | Real rebuild; returns structured result                            |
| `/graph status`     | Returns executable path, vault status, index metadata, watcher/app status |

### Executable Discovery (Priority)

1. Packaged companion path adjacent to installed MND CLI.
2. Configured executable path.
3. Platform install location.
4. Repository dev path — explicit dev mode only.

### Launch Rules

```ts
spawn(executable, args, { shell: false, detached: true, stdio: 'ignore' })
```

Vault path passed as explicit argument. No shell interpolation. `unref()` if appropriate.

### Error Outcomes

`executable_not_found`, `invalid_executable`, `vault_not_configured`, `invalid_node_id`, `rebuild_failure`.
