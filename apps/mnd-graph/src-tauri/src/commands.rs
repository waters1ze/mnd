use tauri::{AppHandle, State, Manager};
use tauri_plugin_dialog::DialogExt;
use std::collections::HashMap;
use std::sync::Mutex;
use std::path::PathBuf;
use std::fs;
use uuid::Uuid;
use crate::security::{resolve_vault_path, atomic_write_vault_file};
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct FolderCandidate {
    pub candidate_id: String,
    pub display_path: String,
    pub display_name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PreviewInitializationResult {
    pub preview_token: String,
    pub create_set: Vec<String>,
}

pub struct VaultState {
    pub candidates: Mutex<HashMap<String, PathBuf>>,
    pub preview_tokens: Mutex<HashMap<String, String>>,
}

#[tauri::command]
pub async fn select_vault_directory(app: AppHandle, state: State<'_, VaultState>) -> Result<FolderCandidate, String> {
    let folder_path = app.dialog().file().blocking_pick_folder();
    
    if let Some(path) = folder_path {
        let path_buf = PathBuf::from(path.to_string());
        let id = Uuid::new_v4().to_string();
        let display_path = path_buf.to_string_lossy().into_owned();
        let display_name = path_buf.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        
        state.candidates.lock().unwrap().insert(id.clone(), path_buf);
        
        Ok(FolderCandidate {
            candidate_id: id,
            display_path,
            display_name,
        })
    } else {
        Err("NO_DIRECTORY_SELECTED".into())
    }
}

#[tauri::command]
pub fn classify_vault_destination(state: State<'_, VaultState>, candidate_id: String) -> Result<String, String> {
    let map = state.candidates.lock().unwrap();
    let path = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    
    if !path.exists() {
        return Ok("NEW_DIRECTORY".to_string());
    }
    
    let is_empty = fs::read_dir(path).map(|mut iter| iter.next().is_none()).unwrap_or(false);
    if is_empty {
        Ok("EMPTY_DIRECTORY".to_string())
    } else {
        Ok("EXISTING_DIRECTORY".to_string())
    }
}

#[tauri::command]
pub fn preview_vault_initialization(state: State<'_, VaultState>, candidate_id: String, mode: String) -> Result<PreviewInitializationResult, String> {
    let token = Uuid::new_v4().to_string();
    state.preview_tokens.lock().unwrap().insert(candidate_id.clone(), token.clone());
    
    Ok(PreviewInitializationResult {
        preview_token: token,
        create_set: vec![
            ".mnd/config.json".to_string(),
            ".mnd/state.json".to_string(),
        ],
    })
}

#[tauri::command]
pub fn initialize_vault(state: State<'_, VaultState>, candidate_id: String, preview_token: String) -> Result<(), String> {
    let mut tokens = state.preview_tokens.lock().unwrap();
    if tokens.get(&candidate_id) != Some(&preview_token) {
        return Err("INVALID_PREVIEW_TOKEN".to_string());
    }
    
    let map = state.candidates.lock().unwrap();
    let root = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    
    let mnd_dir = root.join(".mnd");
    fs::create_dir_all(&mnd_dir).map_err(|_| "FAILED_CREATE_DIR")?;
    
    if let Err(_) = fs::write(mnd_dir.join("config.json"), "{}") {
        let _ = fs::remove_dir_all(&mnd_dir);
        return Err("FAILED_INIT_ROLLBACK_DONE".to_string());
    }
    
    tokens.remove(&candidate_id);
    Ok(())
}

#[tauri::command]
pub fn read_vault_file(state: State<'_, VaultState>, candidate_id: String, relative_path: String) -> Result<String, String> {
    let map = state.candidates.lock().unwrap();
    let root = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    let target = resolve_vault_path(root, &PathBuf::from(relative_path))?;
    fs::read_to_string(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_vault_file(state: State<'_, VaultState>, candidate_id: String, relative_path: String, content: String) -> Result<(), String> {
    let map = state.candidates.lock().unwrap();
    let root = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    let target = resolve_vault_path(root, &PathBuf::from(relative_path))?;
    atomic_write_vault_file(&target, content.as_bytes())
}
