use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentVault {
    pub path: String,
    pub last_opened: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub active_vault_path: Option<String>,
    pub recent_vaults: Vec<RecentVault>,
    pub updated_at: String,
}

#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    // TODO: Read from actual config file
    Ok(AppConfig {
        schema_version: 1,
        active_vault_path: None,
        recent_vaults: vec![],
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn set_active_vault(app: AppHandle, path: String) -> Result<(), String> {
    // TODO: Update active vault in config file
    Ok(())
}

#[tauri::command]
pub async fn forget_recent_vault(app: AppHandle, path: String) -> Result<(), String> {
    // TODO: Remove vault from recent vaults in config file
    Ok(())
}
