use std::path::{Path, PathBuf};
use std::fs::{self, OpenOptions};
use std::io::Write;
use sha2::{Sha256, Digest};
use uuid::Uuid;

pub fn resolve_vault_path(vault_root: &Path, relative_path: &Path) -> Result<PathBuf, String> {
    if relative_path.is_absolute() {
        return Err("DRIVE_ROOT_ACCESS".to_string());
    }

    let rel_str = relative_path.to_string_lossy();
    if rel_str.contains("..") {
        return Err("PATH_TRAVERSAL".to_string());
    }

    let resolved = vault_root.join(relative_path);

    if let Ok(canonical_root) = vault_root.canonicalize() {
        if resolved.exists() {
            if let Ok(canonical_resolved) = resolved.canonicalize() {
                if !canonical_resolved.starts_with(&canonical_root) {
                    return Err("SYMLINK_ESCAPE".to_string());
                }
            }
        } else {
            // For new files, verify the parent dir is contained
            if let Some(parent) = resolved.parent() {
                if parent.exists() {
                    if let Ok(canonical_parent) = parent.canonicalize() {
                        if !canonical_parent.starts_with(&canonical_root) {
                            return Err("SYMLINK_ESCAPE".to_string());
                        }
                    }
                }
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

    let temp_name = format!(".{}.tmp", Uuid::new_v4());
    let temp_path = target_path.with_file_name(&temp_name);

    let backup_dir = target_path.parent().unwrap_or(Path::new("")).join(".mnd/backups");
    let backup_id = Uuid::new_v4().to_string();
    let backup_path = backup_dir.join(&backup_id);

    if !backup_dir.exists() {
        let _ = fs::create_dir_all(&backup_dir);
    }

    if target_path.exists() {
        let _ = fs::copy(target_path, &backup_path);
    }

    let mut temp_file = OpenOptions::new()
        .write(true)
        .create_new(true) // Exclusive create
        .open(&temp_path)
        .map_err(|e| e.to_string())?;

    temp_file.write_all(content).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })?;

    temp_file.sync_all().map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })?;

    // Drop temp_file explicitly before rename (especially on Windows)
    drop(temp_file);

    fs::rename(&temp_path, target_path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })?;

    // Reread verification
    let written = fs::read(target_path).map_err(|e| e.to_string())?;
    let mut expected_hasher = Sha256::new();
    expected_hasher.update(content);
    let expected_hash = expected_hasher.finalize();

    let mut actual_hasher = Sha256::new();
    actual_hasher.update(&written);
    let actual_hash = actual_hasher.finalize();

    if expected_hash != actual_hash {
        // Rollback
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, target_path);
        }
        return Err("VERIFICATION_FAILED".to_string());
    }

    // Cleanup backup
    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }

    Ok(())
}
