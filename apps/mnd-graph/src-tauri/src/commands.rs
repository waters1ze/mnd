use tauri::{AppHandle, State, Manager};
use tauri_plugin_dialog::DialogExt;
use std::path::PathBuf;
use std::fs;
use uuid::Uuid;
use crate::state::VaultState;
use crate::models::{FolderCandidate, PreviewInitializationResult, Classification, BaseIdentity};
use crate::security::{resolve_vault_path, atomic_write_vault_file};
use sha2::{Sha256, Digest};
use std::time::SystemTime;

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
pub fn classify_vault_destination(state: State<'_, VaultState>, candidate_id: String) -> Result<Classification, String> {
    let map = state.candidates.lock().unwrap();
    let path = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    
    if !path.exists() {
        return Ok(Classification::Missing);
    }
    
    if !path.is_dir() {
        return Ok(Classification::FileNotDirectory);
    }
    
    if path.parent().is_none() {
        return Ok(Classification::DriveRoot);
    }
    
    match fs::read_dir(path) {
        Err(_) => return Ok(Classification::Inaccessible),
        Ok(mut iter) => {
            if iter.next().is_none() {
                return Ok(Classification::EmptyDirectory);
            }
        }
    }
    
    if path.join(".mnd").join("config.json").exists() {
        return Ok(Classification::ExistingMndVault);
    }
    
    if path.join(".obsidian").exists() {
        return Ok(Classification::ExistingObsidianVault);
    }
    
    Ok(Classification::UnknownNonemptyDirectory)
}

#[tauri::command]
pub fn preview_vault_initialization(state: State<'_, VaultState>, candidate_id: String, _mode: String) -> Result<PreviewInitializationResult, String> {
    let token = Uuid::new_v4().to_string();
    state.preview_tokens.lock().unwrap().insert(candidate_id.clone(), token.clone());
    
    Ok(PreviewInitializationResult {
        preview_token: token,
        create_set: vec![
            ".mnd/config.json".to_string(),
            ".mnd/state.json".to_string(),
            "Home.md".to_string(),
            "Projects/".to_string(),
            "Assets/Images/".to_string(),
            "Assets/Audio/".to_string(),
            "templates/".to_string(),
            ".mnd/backups/".to_string(),
        ],
    })
}

#[tauri::command]
pub fn initialize_vault(state: State<'_, VaultState>, candidate_id: String, preview_token: String) -> Result<String, String> {
    let mut tokens = state.preview_tokens.lock().unwrap();
    if tokens.get(&candidate_id) != Some(&preview_token) {
        return Err("INVALID_PREVIEW_TOKEN".to_string());
    }
    
    let map = state.candidates.lock().unwrap();
    let root = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    
    let mnd_dir = root.join(".mnd");
    fs::create_dir_all(mnd_dir.join("backups")).map_err(|_| "FAILED_CREATE_DIR")?;
    fs::create_dir_all(root.join("Projects")).map_err(|_| "FAILED_CREATE_DIR")?;
    fs::create_dir_all(root.join("Assets").join("Images")).map_err(|_| "FAILED_CREATE_DIR")?;
    fs::create_dir_all(root.join("Assets").join("Audio")).map_err(|_| "FAILED_CREATE_DIR")?;
    fs::create_dir_all(root.join("templates")).map_err(|_| "FAILED_CREATE_DIR")?;
    
    fs::write(root.join("Home.md"), "# Home\nWelcome to your MND Vault.").map_err(|_| "FAILED_WRITE")?;
    fs::write(mnd_dir.join("config.json"), "{}").map_err(|_| "FAILED_WRITE")?;
    fs::write(mnd_dir.join("state.json"), "{}").map_err(|_| "FAILED_WRITE")?;
    
    tokens.remove(&candidate_id);
    let vault_id = Uuid::new_v4().to_string();
    *state.active_vault_id.lock().unwrap() = Some(vault_id.clone());
    *state.active_vault_path.lock().unwrap() = Some(root.clone());
    
    Ok(vault_id)
}

fn get_active_root(state: &State<'_, VaultState>, vault_id: &str) -> Result<PathBuf, String> {
    let id_lock = state.active_vault_id.lock().unwrap();
    let path_lock = state.active_vault_path.lock().unwrap();
    
    if id_lock.as_deref() == Some(vault_id) {
        if let Some(ref p) = *path_lock {
            return Ok(p.clone());
        }
    }
    Err("INVALID_VAULT_ID".to_string())
}

#[tauri::command]
pub fn read_vault_file(state: State<'_, VaultState>, vault_id: String, relative_path: String) -> Result<String, String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;
    fs::read_to_string(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn atomic_write_vault_file(state: State<'_, VaultState>, vault_id: String, relative_path: String, content: String, _base_identity: Option<BaseIdentity>) -> Result<BaseIdentity, String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;
    
    // TODO: implement base_identity check here if _base_identity is Some
    
    let content_bytes = content.as_bytes();
    atomic_write_vault_file_impl(&target, content_bytes)?;
    
    let meta = fs::metadata(&target).map_err(|e| e.to_string())?;
    let mtime = meta.modified().unwrap_or(SystemTime::now())
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default().as_secs();
    
    let mut hasher = Sha256::new();
    hasher.update(content_bytes);
    let sha256 = format!("{:x}", hasher.finalize());
    
    Ok(BaseIdentity {
        mtime,
        size: meta.len(),
        sha256,
    })
}

fn atomic_write_vault_file_impl(target_path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    crate::security::atomic_write_vault_file(target_path, content)
}

#[tauri::command]
pub fn list_vault_directory(state: State<'_, VaultState>, vault_id: String, relative_path: String) -> Result<Vec<String>, String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;
    
    let mut entries = Vec::new();
    if target.is_dir() {
        if let Ok(iter) = fs::read_dir(target) {
            for entry in iter.flatten() {
                entries.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn create_vault_entry(state: State<'_, VaultState>, vault_id: String, relative_path: String, is_dir: bool) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;
    if target.exists() {
        return Err("ALREADY_EXISTS".to_string());
    }
    if is_dir {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
    } else {
        fs::write(target, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_vault_entry(state: State<'_, VaultState>, vault_id: String, old_relative_path: String, new_relative_path: String) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let old_target = resolve_vault_path(&root, &PathBuf::from(old_relative_path))?;
    let new_target = resolve_vault_path(&root, &PathBuf::from(new_relative_path))?;
    if new_target.exists() {
        return Err("DESTINATION_EXISTS".to_string());
    }
    fs::rename(old_target, new_target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_vault_entry(state: State<'_, VaultState>, vault_id: String, relative_path: String, new_parent_path: String) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(&relative_path))?;
    let parent = resolve_vault_path(&root, &PathBuf::from(&new_parent_path))?;
    let name = target.file_name().ok_or("INVALID_NAME")?;
    let new_target = parent.join(name);
    if new_target.exists() {
        return Err("DESTINATION_EXISTS".to_string());
    }
    fs::rename(target, new_target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn duplicate_vault_entry(state: State<'_, VaultState>, vault_id: String, relative_path: String) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(&relative_path))?;
    let ext = target.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default();
    let name = target.file_stem().ok_or("INVALID_NAME")?.to_string_lossy().into_owned();
    let new_name = format!("{}.copy.{}", name, ext);
    let new_target = target.with_file_name(new_name);
    if new_target.exists() {
        return Err("DESTINATION_EXISTS".to_string());
    }
    fs::copy(target, new_target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn trash_vault_entry(state: State<'_, VaultState>, vault_id: String, relative_path: String, permanent: bool) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;
    if permanent {
        if target.is_dir() {
            fs::remove_dir_all(target).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(target).map_err(|e| e.to_string())?;
        }
    } else {
        // Just move to .mnd/trash
        let trash_dir = root.join(".mnd").join("trash");
        let _ = fs::create_dir_all(&trash_dir);
        let name = target.file_name().ok_or("INVALID_NAME")?;
        let trash_target = trash_dir.join(name);
        fs::rename(target, trash_target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_vault_entry(state: State<'_, VaultState>, vault_id: String, relative_path: String) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;
    
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .args(["/select,", &target.to_string_lossy()])
        .spawn()
        .map_err(|e| e.to_string())?;
        
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .args(["-R", &target.to_string_lossy()])
        .spawn()
        .map_err(|e| e.to_string())?;
        
    Ok(())
}
