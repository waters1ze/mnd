use crate::models::AppConfig;
use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct VaultState {
    pub candidates: Mutex<HashMap<String, PathBuf>>,
    pub preview_tokens: Mutex<HashMap<String, String>>,
    pub active_vault_id: Mutex<Option<String>>,
    pub active_vault_path: Mutex<Option<PathBuf>>,
    pub active_watcher: Mutex<Option<RecommendedWatcher>>,
    pub watcher_vault_id: Mutex<Option<String>>,
    pub config: Mutex<AppConfig>,
    pub config_path: PathBuf,
}

impl VaultState {
    pub fn load(config_path: PathBuf) -> Self {
        let config = std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AppConfig>(&raw).ok())
            .unwrap_or_default();
        let restored_path = config
            .active_vault_path
            .as_ref()
            .map(PathBuf::from)
            .filter(|path| path.is_dir());
        let restored_id = restored_path.as_ref().and(config.active_vault_id.clone());
        Self {
            candidates: Mutex::new(HashMap::new()),
            preview_tokens: Mutex::new(HashMap::new()),
            active_vault_id: Mutex::new(restored_id),
            active_vault_path: Mutex::new(restored_path),
            active_watcher: Mutex::new(None),
            watcher_vault_id: Mutex::new(None),
            config: Mutex::new(config),
            config_path,
        }
    }
}
