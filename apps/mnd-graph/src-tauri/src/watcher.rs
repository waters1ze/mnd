use crate::state::VaultState;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChangeEvent {
    kind: String,
    paths: Vec<String>,
    requires_full_rescan: bool,
    error: Option<String>,
}

fn event_kind(kind: &EventKind) -> (&'static str, bool) {
    match kind {
        EventKind::Create(_) => ("create", false),
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => ("rename", false),
        EventKind::Modify(_) => ("modify", false),
        EventKind::Remove(_) => ("delete", false),
        EventKind::Access(_) => ("access", false),
        EventKind::Other | EventKind::Any => ("rescan", true),
    }
}

#[tauri::command]
pub async fn start_vault_watcher(
    app: AppHandle,
    state: State<'_, VaultState>,
    vault_id: String,
) -> Result<(), String> {
    let active_id = state.active_vault_id.lock().unwrap().clone();
    if active_id.as_deref() != Some(vault_id.as_str()) {
        return Err("INVALID_VAULT_ID".to_string());
    }
    let root = state
        .active_vault_path
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "VAULT_PATH_UNAVAILABLE".to_string())?;
    let watched_root = root.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| match result {
            Ok(event) => {
                let (kind, requires_full_rescan) = event_kind(&event.kind);
                let paths = event
                    .paths
                    .into_iter()
                    .filter_map(|path| {
                        let relative = path.strip_prefix(&watched_root).ok()?;
                        if relative.starts_with(".mnd") || relative.starts_with(".obsidian") {
                            return None;
                        }
                        Some(relative.to_string_lossy().replace('\\', "/"))
                    })
                    .collect::<Vec<_>>();
                if !paths.is_empty() || requires_full_rescan {
                    let _ = app.emit(
                        "vault://changed",
                        VaultChangeEvent {
                            kind: kind.to_string(),
                            paths,
                            requires_full_rescan,
                            error: None,
                        },
                    );
                }
            }
            Err(error) => {
                let _ = app.emit(
                    "vault://changed",
                    VaultChangeEvent {
                        kind: "error".to_string(),
                        paths: Vec::new(),
                        requires_full_rescan: true,
                        error: Some(error.to_string()),
                    },
                );
            }
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    *state.active_watcher.lock().unwrap() = Some(watcher);
    *state.watcher_vault_id.lock().unwrap() = Some(vault_id);
    Ok(())
}

#[tauri::command]
pub async fn stop_vault_watcher(
    state: State<'_, VaultState>,
    vault_id: String,
) -> Result<(), String> {
    if state
        .watcher_vault_id
        .lock()
        .map_err(|_| "WATCHER_LOCK_POISONED")?
        .as_deref()
        != Some(vault_id.as_str())
    {
        return Err("WATCHER_VAULT_MISMATCH".to_string());
    }
    *state.active_watcher.lock().unwrap() = None;
    *state.watcher_vault_id.lock().unwrap() = None;
    Ok(())
}
