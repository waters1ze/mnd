use std::collections::HashMap;
use std::sync::Mutex;
use std::path::PathBuf;

#[derive(Default)]
pub struct VaultState {
    pub candidates: Mutex<HashMap<String, PathBuf>>,
    pub preview_tokens: Mutex<HashMap<String, String>>,
    pub active_vault_id: Mutex<Option<String>>,
    pub active_vault_path: Mutex<Option<PathBuf>>,
    pub active_watcher: Mutex<Option<String>>,
}
