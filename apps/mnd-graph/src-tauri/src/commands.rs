use crate::models::{
    BaseIdentity, Classification, DirectoryEntry, FileReadResult, FolderCandidate,
    PreviewInitializationResult,
};
use crate::security::resolve_vault_path;
use crate::state::VaultState;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const VAULT_DIRECTORIES: &[&str] = &[
    ".obsidian",
    ".mnd",
    ".mnd/backups",
    "Projects",
    "Assets",
    "Images",
    "Audio",
    "B-Roll",
    "Thumbnails",
    "Transcripts",
    "Global_Rules",
    "Styles",
    "Skills",
    "Templates",
    "Exports",
];

fn classify_path(path: &Path) -> Classification {
    if !path.exists() {
        return Classification::Missing;
    }
    if !path.is_dir() {
        return Classification::FileNotDirectory;
    }
    if path.parent().is_none() {
        return Classification::DriveRoot;
    }
    let mut entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return Classification::Inaccessible,
    };
    if entries.next().is_none() {
        return Classification::EmptyDirectory;
    }
    if path.join(".mnd").join("config.json").is_file() {
        return Classification::ExistingMndVault;
    }
    if path.join(".obsidian").is_dir() {
        return Classification::ExistingObsidianVault;
    }
    let compatible = fs::read_dir(path)
        .map(|entries| {
            entries.flatten().all(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                entry.path().is_dir()
                    || name.ends_with(".md")
                    || name.ends_with(".base")
                    || name == ".gitignore"
            })
        })
        .unwrap_or(false);
    if compatible {
        Classification::CompatibleExistingVault
    } else {
        Classification::UnknownNonemptyDirectory
    }
}

fn destination_fingerprint(path: &Path) -> Result<String, String> {
    let mut entries = Vec::new();
    if path.exists() && path.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            entries.push(format!(
                "{}:{}:{}",
                entry.file_name().to_string_lossy(),
                metadata.len(),
                metadata
                    .modified()
                    .ok()
                    .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|value| value.as_nanos())
                    .unwrap_or(0)
            ));
        }
        entries.sort();
    }
    let mut hasher = Sha256::new();
    hasher.update(format!("{:?}|{}", classify_path(path), entries.join("|")));
    Ok(format!("{:x}", hasher.finalize()))
}

fn identity(path: &Path) -> Result<BaseIdentity, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let mtime = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64;
    Ok(BaseIdentity {
        mtime,
        size: metadata.len(),
        sha256: crate::security::sha256_file(path)?,
    })
}

#[tauri::command]
pub async fn select_vault_directory(
    app: AppHandle,
    state: State<'_, VaultState>,
) -> Result<FolderCandidate, String> {
    let folder_path = app.dialog().file().blocking_pick_folder();

    if let Some(path) = folder_path {
        let path_buf = PathBuf::from(path.to_string());
        let id = Uuid::new_v4().to_string();
        let display_path = path_buf.to_string_lossy().into_owned();
        let display_name = path_buf
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        state
            .candidates
            .lock()
            .unwrap()
            .insert(id.clone(), path_buf);

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
pub fn classify_vault_destination(
    state: State<'_, VaultState>,
    candidate_id: String,
) -> Result<Classification, String> {
    let map = state.candidates.lock().unwrap();
    let path = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;

    Ok(classify_path(path))
}

#[tauri::command]
pub fn preview_vault_initialization(
    state: State<'_, VaultState>,
    candidate_id: String,
    mode: String,
) -> Result<PreviewInitializationResult, String> {
    let map = state
        .candidates
        .lock()
        .map_err(|_| "CANDIDATE_LOCK_POISONED")?;
    let path = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    let classification = classify_path(path);
    if !matches!(
        classification,
        Classification::EmptyDirectory
            | Classification::ExistingMndVault
            | Classification::ExistingObsidianVault
            | Classification::CompatibleExistingVault
    ) {
        return Err(format!("UNSUPPORTED_DESTINATION:{classification:?}"));
    }
    if mode != "new" && mode != "open" && mode != "integrate" {
        return Err("INVALID_INITIALIZATION_MODE".to_string());
    }
    let fingerprint = destination_fingerprint(path)?;
    let token = format!("{}.{}", Uuid::new_v4(), fingerprint);
    let create_set = if classification == Classification::ExistingMndVault {
        Vec::new()
    } else {
        VAULT_DIRECTORIES
            .iter()
            .filter(|relative| !path.join(relative).exists())
            .map(|relative| format!("{relative}/"))
            .chain(
                ["Home.md", ".mnd/config.json", ".mnd/state.json"]
                    .into_iter()
                    .filter(|relative| !path.join(relative).exists())
                    .map(str::to_string),
            )
            .collect()
    };
    drop(map);
    state
        .preview_tokens
        .lock()
        .unwrap()
        .insert(candidate_id.clone(), token.clone());

    Ok(PreviewInitializationResult {
        preview_token: token,
        create_set,
    })
}

#[tauri::command]
pub fn initialize_vault(
    state: State<'_, VaultState>,
    candidate_id: String,
    preview_token: String,
) -> Result<String, String> {
    let mut tokens = state
        .preview_tokens
        .lock()
        .map_err(|_| "PREVIEW_LOCK_POISONED")?;
    if tokens.get(&candidate_id) != Some(&preview_token) {
        return Err("INVALID_PREVIEW_TOKEN".to_string());
    }

    let map = state
        .candidates
        .lock()
        .map_err(|_| "CANDIDATE_LOCK_POISONED")?;
    let root = map.get(&candidate_id).ok_or("INVALID_CANDIDATE")?;
    let expected_fingerprint = preview_token
        .rsplit_once('.')
        .ok_or("INVALID_PREVIEW_TOKEN")?
        .1;
    if destination_fingerprint(root)? != expected_fingerprint {
        return Err("DESTINATION_CHANGED_AFTER_PREVIEW".to_string());
    }
    let classification = classify_path(root);
    if !matches!(
        classification,
        Classification::EmptyDirectory
            | Classification::ExistingMndVault
            | Classification::ExistingObsidianVault
            | Classification::CompatibleExistingVault
    ) {
        return Err(format!("UNSUPPORTED_DESTINATION:{classification:?}"));
    }

    let existing_vault_id = fs::read_to_string(root.join(".mnd/config.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("vaultId")
                .and_then(|id| id.as_str())
                .map(str::to_string)
        });
    let vault_id = existing_vault_id.unwrap_or_else(|| {
        if classification == Classification::ExistingMndVault {
            let canonical = root.canonicalize().unwrap_or_else(|_| root.clone());
            let digest = crate::security::sha256_bytes(canonical.to_string_lossy().as_bytes());
            format!("vault_{}", &digest[..24])
        } else {
            Uuid::new_v4().to_string()
        }
    });
    if classification != Classification::ExistingMndVault {
        let mut created_files = Vec::new();
        let mut created_dirs = Vec::new();
        let creation = (|| -> Result<(), String> {
            for relative in VAULT_DIRECTORIES {
                let directory = root.join(relative);
                if !directory.exists() {
                    fs::create_dir(&directory)
                        .map_err(|error| format!("FAILED_CREATE_DIR:{relative}:{error}"))?;
                    created_dirs.push(directory);
                }
            }
            let files = [
                (
                    "Home.md",
                    "# Home\n\nWelcome to your MND Vault.\n".to_string(),
                ),
                (
                    ".mnd/config.json",
                    format!(
                        "{}\n",
                        serde_json::to_string_pretty(&serde_json::json!({
                            "schemaVersion": 1,
                            "vaultId": vault_id,
                            "createdAt": Utc::now().to_rfc3339(),
                            "generator": "mnd-graph"
                        }))
                        .map_err(|error| error.to_string())?
                    ),
                ),
                (
                    ".mnd/state.json",
                    "{\n  \"schemaVersion\": 1\n}\n".to_string(),
                ),
            ];
            for (relative, content) in files {
                let file_path = root.join(relative);
                if file_path.exists() {
                    continue;
                }
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&file_path)
                    .map_err(|error| format!("FAILED_CREATE_FILE:{relative}:{error}"))?;
                file.write_all(content.as_bytes())
                    .map_err(|error| error.to_string())?;
                file.sync_all().map_err(|error| error.to_string())?;
                created_files.push(file_path);
            }
            Ok(())
        })();
        if let Err(error) = creation {
            for file in created_files.iter().rev() {
                let _ = fs::remove_file(file);
            }
            for directory in created_dirs.iter().rev() {
                let _ = fs::remove_dir(directory);
            }
            return Err(error);
        }
    }

    tokens.remove(&candidate_id);
    *state.active_vault_id.lock().unwrap() = Some(vault_id.clone());
    *state.active_vault_path.lock().unwrap() = Some(root.clone());
    crate::config::activate_vault(&state, &vault_id, root)?;

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
pub fn read_vault_file(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
) -> Result<FileReadResult, String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;
    let content = fs::read_to_string(&target).map_err(|e| e.to_string())?;
    Ok(FileReadResult {
        content,
        identity: identity(&target)?,
    })
}

#[tauri::command]
pub fn atomic_write_vault_file(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
    content: String,
    base_identity: Option<BaseIdentity>,
) -> Result<BaseIdentity, String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;

    if let Some(expected) = base_identity {
        if !target.is_file() || identity(&target)? != expected {
            return Err("EXTERNAL_CHANGE_CONFLICT".to_string());
        }
    } else if target.exists() {
        return Err("BASE_IDENTITY_REQUIRED".to_string());
    }

    let content_bytes = content.as_bytes();
    atomic_write_vault_file_impl(&target, content_bytes)?;

    identity(&target)
}

fn atomic_write_vault_file_impl(
    target_path: &std::path::Path,
    content: &[u8],
) -> Result<(), String> {
    crate::security::atomic_write_vault_file(target_path, content)
}

#[tauri::command]
pub fn list_vault_directory(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
) -> Result<Vec<DirectoryEntry>, String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(relative_path))?;

    let mut entries = Vec::new();
    if target.is_dir() {
        if let Ok(iter) = fs::read_dir(target) {
            for entry in iter.flatten() {
                let path = entry.path();
                let metadata = entry.metadata().map_err(|error| error.to_string())?;
                let relative = path.strip_prefix(&root).map_err(|_| "PATH_ESCAPE")?;
                let extension = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let media_kind = match extension.as_str() {
                    "png" | "jpg" | "jpeg" | "gif" | "webp" => "image",
                    "mp4" | "mov" | "mkv" | "webm" => "video",
                    "mp3" | "wav" | "m4a" | "flac" | "ogg" => "audio",
                    "md" => "markdown",
                    "json" => "json",
                    "xml" | "fcpxml" => "xml",
                    _ if metadata.is_dir() => "directory",
                    _ => "binary",
                };
                entries.push(DirectoryEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: relative.to_string_lossy().replace('\\', "/"),
                    is_directory: metadata.is_dir(),
                    size: metadata.len(),
                    modified: metadata
                        .modified()
                        .ok()
                        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
                        .map(|value| value.as_millis() as u64)
                        .unwrap_or(0),
                    media_kind: media_kind.to_string(),
                });
            }
        }
    }
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn create_vault_entry(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
    is_dir: bool,
) -> Result<(), String> {
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
pub fn rename_vault_entry(
    state: State<'_, VaultState>,
    vault_id: String,
    old_relative_path: String,
    new_relative_path: String,
) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let old_target = resolve_vault_path(&root, &PathBuf::from(old_relative_path))?;
    let new_target = resolve_vault_path(&root, &PathBuf::from(new_relative_path))?;
    if new_target.exists() {
        return Err("DESTINATION_EXISTS".to_string());
    }
    fs::rename(old_target, new_target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_vault_entry(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
    new_parent_path: String,
) -> Result<(), String> {
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
pub fn duplicate_vault_entry(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
) -> Result<(), String> {
    let root = get_active_root(&state, &vault_id)?;
    let target = resolve_vault_path(&root, &PathBuf::from(&relative_path))?;
    let ext = target
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = target
        .file_stem()
        .ok_or("INVALID_NAME")?
        .to_string_lossy()
        .into_owned();
    let new_name = format!("{}.copy.{}", name, ext);
    let new_target = target.with_file_name(new_name);
    if new_target.exists() {
        return Err("DESTINATION_EXISTS".to_string());
    }
    fs::copy(target, new_target).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn trash_vault_entry(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
    permanent: bool,
) -> Result<(), String> {
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
pub fn reveal_vault_entry(
    state: State<'_, VaultState>,
    vault_id: String,
    relative_path: String,
) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destination_classification_uses_real_filesystem_state() {
        let empty = tempfile::tempdir().expect("empty directory");
        assert_eq!(classify_path(empty.path()), Classification::EmptyDirectory);

        let obsidian = tempfile::tempdir().expect("obsidian directory");
        fs::create_dir(obsidian.path().join(".obsidian")).expect("obsidian metadata");
        assert_eq!(
            classify_path(obsidian.path()),
            Classification::ExistingObsidianVault
        );

        let mnd = tempfile::tempdir().expect("mnd directory");
        fs::create_dir(mnd.path().join(".mnd")).expect("mnd metadata");
        fs::write(mnd.path().join(".mnd/config.json"), "{}").expect("mnd config");
        assert_eq!(classify_path(mnd.path()), Classification::ExistingMndVault);

        let compatible = tempfile::tempdir().expect("compatible directory");
        fs::write(compatible.path().join("Note.md"), "# Note").expect("markdown note");
        assert_eq!(
            classify_path(compatible.path()),
            Classification::CompatibleExistingVault
        );

        let unknown = tempfile::tempdir().expect("unknown directory");
        fs::write(unknown.path().join("archive.bin"), [0_u8, 1, 2]).expect("unknown file");
        assert_eq!(
            classify_path(unknown.path()),
            Classification::UnknownNonemptyDirectory
        );
    }

    #[test]
    fn preview_fingerprint_changes_after_destination_mutation() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let before = destination_fingerprint(directory.path()).expect("first fingerprint");
        fs::write(directory.path().join("note.md"), "content").expect("mutation");
        let after = destination_fingerprint(directory.path()).expect("second fingerprint");
        assert_ne!(before, after);
    }
}
