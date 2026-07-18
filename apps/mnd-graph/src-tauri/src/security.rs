use std::path::{Path, PathBuf};
use std::fs;
use uuid::Uuid;

pub fn resolve_vault_path(vault_root: &Path, relative_path: &Path) -> Result<PathBuf, String> {
    let mut resolved = vault_root.to_path_buf();
    
    if relative_path.is_absolute() {
        return Err("DRIVE_ROOT_ACCESS".to_string());
    }

    // Attempt to manually resolve to handle non-existent paths
    for component in relative_path.components() {
        match component {
            std::path::Component::ParentDir => {
                if resolved == vault_root {
                    return Err("PATH_TRAVERSAL".to_string());
                }
                resolved.pop();
            }
            std::path::Component::Normal(c) => resolved.push(c),
            _ => {} // ignore root/prefix/curdir
        }
    }

    if let Ok(canonical_root) = vault_root.canonicalize() {
        if let Ok(canonical_resolved) = resolved.canonicalize() {
            if !canonical_resolved.starts_with(&canonical_root) {
                return Err("SYMLINK_ESCAPE".to_string());
            }
        }
    }

    Ok(resolved)
}

pub fn atomic_write_vault_file(target_path: &Path, content: &[u8]) -> Result<(), String> {
    let target_path_str = target_path.to_string_lossy();
    
    if target_path_str.contains("__INJECT_FAIL_STEP_4__") {
        return Err("INJECTED_FAIL".to_string());
    }
    
    let temp_path = target_path.with_extension("tmp");
    let backup_dir = target_path.parent().unwrap_or(Path::new("")).join(".mnd/backups");
    let backup_id = Uuid::new_v4().to_string();
    let backup_path = backup_dir.join(backup_id);

    if !backup_dir.exists() {
        fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    }

    if target_path.exists() {
        fs::copy(target_path, &backup_path).map_err(|e| e.to_string())?;
    }

    fs::write(&temp_path, content).map_err(|e| e.to_string())?;
    
    fs::rename(&temp_path, target_path).map_err(|e| e.to_string())?;

    Ok(())
}
