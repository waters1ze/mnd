use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

#[tauri::command]
pub async fn preview_vault_copy(source: String, destination: String) -> Result<String, String> {
    // Return a preview/plan of the copy operation
    Ok(format!("Preview: Copy from {} to {}", source, destination))
}

#[tauri::command]
pub async fn copy_vault_safely(source: String, destination: String) -> Result<(), String> {
    let dest_path = Path::new(&destination);
    let dest_parent = dest_path.parent().ok_or("Invalid destination")?;
    let dest_name = dest_path.file_name().ok_or("Invalid destination name")?;
    
    let uuid = Uuid::new_v4();
    let staging_name = format!(".{}.mnd-copy-staging-{}", dest_name.to_string_lossy(), uuid);
    let staging_path = dest_parent.join(staging_name);

    // TODO: Implement actual recursive copy, SHA-256 verification per file
    // 1. Copy to staging_path
    // 2. Verify SHA-256
    // 3. Rename staging_path to dest_path
    
    Ok(())
}

#[tauri::command]
pub async fn open_vault_in_obsidian(path: String) -> Result<(), String> {
    let url = format!("obsidian://open?path={}", urlencoding::encode(&path));
    
    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}
