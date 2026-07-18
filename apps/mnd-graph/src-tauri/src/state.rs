use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Default)]
pub struct VaultState {
    pub vaults: RwLock<HashMap<String, String>>,
    pub candidates: RwLock<HashMap<String, String>>,
}
