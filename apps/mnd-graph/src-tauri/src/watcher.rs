use tauri::State;
use crate::state::VaultState;

#[tauri::command]
pub async fn start_vault_watcher(state: State<'_, VaultState>, vault_id: String) -> Result<(), String> {
    let id_lock = state.active_vault_id.lock().unwrap();
    if id_lock.as_deref() == Some(vault_id.as_str()) {
        *state.active_watcher.lock().unwrap() = Some(vault_id.clone());
        println!("Starting vault watcher for vault: {}", vault_id);
        Ok(())
    } else {
        Err("INVALID_VAULT_ID".to_string())
    }
}

#[tauri::command]
pub async fn stop_vault_watcher(state: State<'_, VaultState>) -> Result<(), String> {
    *state.active_watcher.lock().unwrap() = None;
    println!("Stopping vault watcher");
    Ok(())
}
