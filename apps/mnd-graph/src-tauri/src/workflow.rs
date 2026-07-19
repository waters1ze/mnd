use crate::commands::get_active_root;
use crate::state::VaultState;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityInfo {
    status: String,
    executable_path: Option<String>,
    version: Option<String>,
    models: Vec<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInventory {
    total_files: u64,
    media_files: u64,
    markdown_files: u64,
    total_bytes: u64,
    by_kind: BTreeMap<String, u64>,
}

fn command_from_where(command: &str) -> Option<PathBuf> {
    let finder = if cfg!(windows) { "where.exe" } else { "which" };
    let output = Command::new(finder).arg(command).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
}

fn agy_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["ANTIGRAVITY_CLI_PATH", "AGY_CLI_PATH"] {
        if let Ok(value) = env::var(variable) {
            candidates.push(PathBuf::from(value));
        }
    }
    if let Some(path) = command_from_where("agy") {
        candidates.push(path);
    }
    if cfg!(windows) {
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_app_data).join("agy/bin/agy.exe"));
        }
        if let Ok(user_profile) = env::var("USERPROFILE") {
            candidates.push(PathBuf::from(user_profile).join("AppData/Local/agy/bin/agy.exe"));
        }
    } else if let Ok(home) = env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/agy"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn run_text(executable: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new(executable)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub fn get_antigravity_info() -> AntigravityInfo {
    let Some(executable) = agy_executable() else {
        return AntigravityInfo {
            status: "not_found".to_string(),
            executable_path: None,
            version: None,
            models: Vec::new(),
        };
    };
    let version = run_text(&executable, &["--version"]).ok();
    let models = run_text(&executable, &["models"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.eq_ignore_ascii_case("available models:"))
        .map(str::to_string)
        .collect::<Vec<_>>();
    AntigravityInfo {
        status: if version.is_some() && !models.is_empty() {
            "ready".to_string()
        } else {
            "unavailable".to_string()
        },
        executable_path: Some(executable.to_string_lossy().into_owned()),
        version,
        models,
    }
}

fn media_kind(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "mxf" | "m4v" | "3gp" => "video",
        "mp3" | "wav" | "m4a" | "flac" | "ogg" | "opus" | "aac" | "aif" | "aiff" => "audio",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" => "image",
        "md" => "markdown",
        "fcpxml" | "xml" => "timeline",
        _ => "other",
    }
}

fn scan_directory(directory: &Path, inventory: &mut VaultInventory) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            let name = entry.file_name();
            if name != ".git" && name != ".mnd" && name != ".obsidian" && name != "node_modules" {
                scan_directory(&path, inventory)?;
            }
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let kind = media_kind(&path).to_string();
        inventory.total_files += 1;
        inventory.total_bytes += metadata.len();
        if kind == "markdown" {
            inventory.markdown_files += 1;
        }
        if matches!(kind.as_str(), "video" | "audio" | "image") {
            inventory.media_files += 1;
        }
        *inventory.by_kind.entry(kind).or_default() += 1;
    }
    Ok(())
}

#[tauri::command]
pub fn scan_vault_inventory(
    state: State<'_, VaultState>,
    vault_id: String,
) -> Result<VaultInventory, String> {
    let root = get_active_root(&state, &vault_id)?;
    let mut inventory = VaultInventory::default();
    scan_directory(&root, &mut inventory)?;
    Ok(inventory)
}

fn node_executable() -> Option<PathBuf> {
    if let Ok(value) = env::var("MND_NODE_PATH") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    command_from_where(if cfg!(windows) { "node.exe" } else { "node" })
}

fn mnd_entry(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(value) = env::var("MND_CLI_ENTRY") {
        candidates.push(PathBuf::from(value));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../dist/index.js"));
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("mnd/dist/index.js"));
        candidates.push(resource_dir.join("dist/index.js"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[tauri::command]
pub async fn run_auto_edit(
    app: AppHandle,
    state: State<'_, VaultState>,
    vault_id: String,
    prompt: String,
    model: String,
    project_name: String,
) -> Result<Value, String> {
    if prompt.trim().is_empty() {
        return Err("PROMPT_REQUIRED".to_string());
    }
    if model.trim().is_empty() {
        return Err("MODEL_REQUIRED".to_string());
    }
    let root = get_active_root(&state, &vault_id)?;
    let node = node_executable().ok_or("NODE_NOT_FOUND")?;
    let entry = mnd_entry(&app).ok_or("MND_CLI_ENTRY_NOT_FOUND")?;
    let agy = agy_executable().ok_or("ANTIGRAVITY_CLI_NOT_FOUND")?;
    tauri::async_runtime::spawn_blocking(move || {
        let root_string = root.to_string_lossy().into_owned();
        let output = Command::new(node)
            .arg(entry)
            .arg("auto")
            .arg("--folder")
            .arg(&root_string)
            .arg("--prompt")
            .arg(prompt.trim())
            .arg("--model")
            .arg(model.trim())
            .arg("--name")
            .arg(project_name.trim())
            .arg("--json")
            .env("MND_VAULT_PATH", &root)
            .env("AGY_CLI_PATH", agy)
            .output()
            .map_err(|error| format!("MND_AUTO_EDIT_LAUNCH_FAILED:{error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut last_json = stdout
            .lines()
            .rev()
            .find_map(|line| serde_json::from_str::<Value>(line).ok());
        if !output.status.success() {
            let message = last_json
                .as_ref()
                .and_then(|value| value.pointer("/error/message"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| String::from_utf8_lossy(&output.stderr).trim().to_string());
            return Err(format!("MND_AUTO_EDIT_FAILED:{message}"));
        }
        if let Some(Value::Object(ref mut object)) = last_json {
            for (path_key, relative_key) in [
                ("fcpxmlPath", "fcpxmlRelativePath"),
                ("thumbnailPath", "thumbnailRelativePath"),
                ("publishMarkdownPath", "publishRelativePath"),
            ] {
                let path = object
                    .get(path_key)
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let Some(path) = path {
                    if let Ok(relative) = Path::new(&path).strip_prefix(&root) {
                        object.insert(
                            relative_key.to_string(),
                            Value::String(relative.to_string_lossy().replace('\\', "/")),
                        );
                    }
                }
            }
        }
        last_json.ok_or_else(|| "MND_AUTO_EDIT_RESULT_MISSING".to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_counts_media_and_skips_internal_directories() {
        let root = tempfile::tempdir().expect("vault");
        fs::write(root.path().join("clip.mp4"), [1_u8, 2, 3]).expect("video");
        fs::write(root.path().join("note.md"), "# Note").expect("note");
        fs::create_dir(root.path().join(".mnd")).expect("internal");
        fs::write(root.path().join(".mnd/hidden.mp4"), [1_u8]).expect("hidden");
        let mut inventory = VaultInventory::default();
        scan_directory(root.path(), &mut inventory).expect("scan");
        assert_eq!(inventory.total_files, 2);
        assert_eq!(inventory.media_files, 1);
        assert_eq!(inventory.markdown_files, 1);
    }
}
