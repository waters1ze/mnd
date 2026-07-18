use tauri::State;
use crate::state::VaultState;

#[tauri::command]
pub async fn get_app_config() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "activeVaultPath": null
    }))
}

#[tauri::command]
pub async fn set_active_vault(state: State<'_, VaultState>, vault_id: String) -> Result<(), String> {
    // We already set this in initialize_vault, but if UI calls it directly:
    // Just mock success if it matches.
    let id_lock = state.active_vault_id.lock().unwrap();
    if id_lock.as_deref() == Some(&vault_id) {
        Ok(())
    } else {
        Err("Vault ID not loaded".to_string())
    }
}

#[tauri::command]
pub async fn forget_recent_vault(_vault_id: String) -> Result<(), String> {
    Ok(())
}
