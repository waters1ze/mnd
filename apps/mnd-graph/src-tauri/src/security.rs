use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

pub fn resolve_vault_path(vault_root: &Path, relative_path: &Path) -> Result<PathBuf, String> {
    if relative_path.as_os_str().is_empty() {
        return Ok(vault_root.to_path_buf());
    }
    if relative_path.is_absolute() {
        return Err("ABSOLUTE_PATH_FORBIDDEN".to_string());
    }
    for component in relative_path.components() {
        match component {
            Component::Normal(name) => validate_component(name.to_string_lossy().as_ref())?,
            Component::CurDir => {}
            Component::ParentDir => return Err("PATH_TRAVERSAL".to_string()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("ABSOLUTE_PATH_FORBIDDEN".to_string())
            }
        }
    }

    let canonical_root = vault_root
        .canonicalize()
        .map_err(|e| format!("VAULT_UNAVAILABLE: {e}"))?;
    let resolved = canonical_root.join(relative_path);
    let mut cursor = canonical_root.clone();
    for component in relative_path.components() {
        if let Component::Normal(name) = component {
            cursor.push(name);
            if let Ok(metadata) = fs::symlink_metadata(&cursor) {
                if metadata.file_type().is_symlink() {
                    return Err("SYMLINK_FORBIDDEN".to_string());
                }
            }
        }
    }
    let mut existing_ancestor = resolved.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor.parent().ok_or("INVALID_PATH")?;
    }
    let canonical_ancestor = existing_ancestor
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical_ancestor.starts_with(&canonical_root) {
        return Err("SYMLINK_ESCAPE".to_string());
    }
    if resolved.exists() {
        let canonical_resolved = resolved.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_resolved.starts_with(&canonical_root) {
            return Err("SYMLINK_ESCAPE".to_string());
        }
    }
    Ok(resolved)
}

fn validate_component(name: &str) -> Result<(), String> {
    if name.is_empty() || name.ends_with(' ') || name.ends_with('.') {
        return Err("INVALID_PATH_COMPONENT".to_string());
    }
    if name
        .chars()
        .any(|character| character == '\0' || "<>:\"|?*".contains(character))
    {
        return Err("INVALID_PATH_COMPONENT".to_string());
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if reserved {
        return Err("WINDOWS_RESERVED_NAME".to_string());
    }
    Ok(())
}

pub fn sha256_bytes(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn atomic_write_vault_file(target_path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target_path.parent().ok_or("INVALID_TARGET")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file_name = target_path
        .file_name()
        .ok_or("INVALID_TARGET")?
        .to_string_lossy();
    let token = Uuid::new_v4();
    let temp_path = parent.join(format!(".{file_name}.tmp.{token}"));
    let replaced_path = parent.join(format!(".{file_name}.replaced.{token}"));

    let result = (|| -> Result<(), String> {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|e| e.to_string())?;
        temp_file.write_all(content).map_err(|e| e.to_string())?;
        temp_file.sync_all().map_err(|e| e.to_string())?;
        drop(temp_file);

        let had_target = target_path.exists();
        if had_target {
            fs::rename(target_path, &replaced_path)
                .map_err(|e| format!("PREPARE_REPLACE_FAILED: {e}"))?;
        }
        if let Err(error) = fs::rename(&temp_path, target_path) {
            if had_target {
                let _ = fs::rename(&replaced_path, target_path);
            }
            return Err(format!("COMMIT_REPLACE_FAILED: {error}"));
        }

        let actual = sha256_file(target_path)?;
        let expected = sha256_bytes(content);
        if actual != expected {
            let _ = fs::remove_file(target_path);
            if had_target {
                let _ = fs::rename(&replaced_path, target_path);
            }
            return Err("WRITE_VERIFICATION_FAILED".to_string());
        }
        if had_target {
            fs::remove_file(&replaced_path)
                .map_err(|e| format!("REPLACED_FILE_CLEANUP_FAILED: {e}"))?;
        }
        if let Ok(parent_handle) = fs::File::open(parent) {
            let _ = parent_handle.sync_all();
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
        if replaced_path.exists() && !target_path.exists() {
            let _ = fs::rename(&replaced_path, target_path);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_security_rejects_escape_and_reserved_names() {
        let vault = tempfile::tempdir().expect("temporary vault");
        assert_eq!(
            resolve_vault_path(vault.path(), Path::new("../outside.md")),
            Err("PATH_TRAVERSAL".to_string())
        );
        assert_eq!(
            resolve_vault_path(vault.path(), Path::new("CON.md")),
            Err("WINDOWS_RESERVED_NAME".to_string())
        );
        assert_eq!(
            resolve_vault_path(vault.path(), Path::new("trailing. ")),
            Err("INVALID_PATH_COMPONENT".to_string())
        );
    }

    #[test]
    fn atomic_write_replaces_and_verifies_content() {
        let vault = tempfile::tempdir().expect("temporary vault");
        let target = vault.path().join("note.md");
        fs::write(&target, b"old").expect("seed file");
        atomic_write_vault_file(&target, b"new content").expect("atomic replacement");
        assert_eq!(fs::read(&target).expect("read replacement"), b"new content");
        assert_eq!(
            sha256_file(&target).expect("hash"),
            sha256_bytes(b"new content")
        );
        let leftovers = fs::read_dir(vault.path())
            .expect("list vault")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(leftovers, vec!["note.md"]);
    }
}
