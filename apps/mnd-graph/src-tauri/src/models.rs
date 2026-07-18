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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BaseIdentity {
    pub mtime: u64,
    pub size: u64,
    pub sha256: String,
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
