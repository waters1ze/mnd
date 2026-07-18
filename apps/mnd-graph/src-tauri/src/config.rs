use crate::models::{AppConfig, RecentVault};
use crate::state::VaultState;
use chrono::Utc;
use std::path::Path;
use tauri::State;

fn persist(state: &VaultState, config: &AppConfig) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    crate::security::atomic_write_vault_file(&state.config_path, &content)
}

pub fn activate_vault(state: &VaultState, vault_id: &str, path: &Path) -> Result<(), String> {
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    let canonical_text = canonical.to_string_lossy().into_owned();
    let now = Utc::now().to_rfc3339();
    let name = canonical
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| canonical_text.clone());
    let mut config = state.config.lock().map_err(|_| "CONFIG_LOCK_POISONED")?;
    config.schema_version = 1;
    config.active_vault_id = Some(vault_id.to_string());
    config.active_vault_path = Some(canonical_text.clone());
    config
        .recent_vaults
        .retain(|entry| entry.vault_id != vault_id);
    config.recent_vaults.insert(
        0,
        RecentVault {
            vault_id: vault_id.to_string(),
            path: canonical_text,
            name,
            last_opened: now.clone(),
        },
    );
    config.recent_vaults.truncate(20);
    config.updated_at = now;
    persist(state, &config)
}

#[tauri::command]
pub async fn get_app_config(state: State<'_, VaultState>) -> Result<AppConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.clone())
        .map_err(|_| "CONFIG_LOCK_POISONED".to_string())
}

#[tauri::command]
pub async fn set_active_vault(
    state: State<'_, VaultState>,
    vault_id: String,
) -> Result<(), String> {
    let active_path = {
        let id = state
            .active_vault_id
            .lock()
            .map_err(|_| "VAULT_LOCK_POISONED")?;
        if id.as_deref() != Some(&vault_id) {
            return Err("VAULT_ID_NOT_LOADED".to_string());
        }
        state
            .active_vault_path
            .lock()
            .map_err(|_| "VAULT_LOCK_POISONED")?
            .clone()
            .ok_or("VAULT_PATH_NOT_LOADED")?
    };
    activate_vault(&state, &vault_id, &active_path)
}

#[tauri::command]
pub async fn forget_recent_vault(
    state: State<'_, VaultState>,
    vault_id: String,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|_| "CONFIG_LOCK_POISONED")?;
    config
        .recent_vaults
        .retain(|entry| entry.vault_id != vault_id);
    if config.active_vault_id.as_deref() == Some(&vault_id) {
        config.active_vault_id = None;
        config.active_vault_path = None;
        *state
            .active_vault_id
            .lock()
            .map_err(|_| "VAULT_LOCK_POISONED")? = None;
        *state
            .active_vault_path
            .lock()
            .map_err(|_| "VAULT_LOCK_POISONED")? = None;
        *state
            .active_watcher
            .lock()
            .map_err(|_| "WATCHER_LOCK_POISONED")? = None;
        *state
            .watcher_vault_id
            .lock()
            .map_err(|_| "WATCHER_LOCK_POISONED")? = None;
    }
    config.updated_at = Utc::now().to_rfc3339();
    persist(&state, &config)
}
