use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCandidate {
    pub candidate_id: String,
    pub display_path: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInitializationResult {
    pub preview_token: String,
    pub create_set: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BaseIdentity {
    pub mtime: u64,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResult {
    pub content: String,
    pub identity: BaseIdentity,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: u64,
    pub media_kind: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecentVault {
    pub vault_id: String,
    pub path: String,
    pub name: String,
    pub last_opened: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub active_vault_id: Option<String>,
    pub active_vault_path: Option<String>,
    pub recent_vaults: Vec<RecentVault>,
    pub updated_at: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            active_vault_id: None,
            active_vault_path: None,
            recent_vaults: Vec::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Classification {
    Missing,
    EmptyDirectory,
    ExistingMndVault,
    ExistingObsidianVault,
    CompatibleExistingVault,
    UnknownNonemptyDirectory,
    FileNotDirectory,
    DriveRoot,
    Inaccessible,
    Invalid,
}
