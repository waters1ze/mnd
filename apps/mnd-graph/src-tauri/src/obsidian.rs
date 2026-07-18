use crate::state::VaultState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;

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
pub async fn preview_vault_copy(
    state: State<'_, VaultState>,
    vault_id: String,
    destination: String,
) -> Result<String, String> {
    let root = get_active_root(&state, &vault_id)?;
    Ok(format!(
        "Preview: Copy from {} to {}",
        root.to_string_lossy(),
        destination
    ))
}

#[tauri::command]
pub async fn copy_vault_safely(
    state: State<'_, VaultState>,
    vault_id: String,
    destination: String,
) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let dest_path = Path::new(&destination);

    let dest_parent = dest_path.parent().unwrap_or_else(|| Path::new(""));
    let dest_name = dest_path.file_name().ok_or("Invalid destination name")?;

    let uuid = Uuid::new_v4();
    let staging_name = format!(".{}.mnd-copy-staging-{}", dest_name.to_string_lossy(), uuid);
    let staging_path = dest_parent.join(staging_name);

    if dest_path.exists() {
        return Err("DESTINATION_EXISTS".to_string());
    }

    // A real recursive copy would verify SHAs
    fs::create_dir_all(&staging_path).map_err(|e| e.to_string())?;

    // Copy the contents
    let options = fs_extra::dir::CopyOptions {
        content_only: true,
        ..Default::default()
    };
    if let Err(e) = fs_extra::dir::copy(&root, &staging_path, &options) {
        let _ = fs::remove_dir_all(&staging_path);
        return Err(e.to_string());
    }

    if let Err(e) = fs::rename(&staging_path, dest_path) {
        let _ = fs::remove_dir_all(&staging_path);
        return Err(e.to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn open_vault_in_obsidian(
    state: State<'_, VaultState>,
    vault_id: String,
) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let url = format!(
        "obsidian://open?path={}",
        urlencoding::encode(&root.to_string_lossy())
    );

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}
