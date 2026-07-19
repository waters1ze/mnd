use crate::state::VaultState;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

fn active_root(state: &State<'_, VaultState>) -> Result<PathBuf, String> {
    state
        .active_vault_path
        .lock()
        .map_err(|_| "VAULT_LOCK_POISONED")?
        .clone()
        .ok_or_else(|| "NO_ACTIVE_VAULT".to_string())
}

fn database_path(vault: &Path) -> PathBuf {
    vault.join(".mnd").join("graph-index.sqlite")
}

fn open_database(vault: &Path) -> Result<Connection, String> {
    fs::create_dir_all(vault.join(".mnd")).map_err(|error| error.to_string())?;
    Connection::open(database_path(vault)).map_err(|error| error.to_string())
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                checksum TEXT NOT NULL,
                mtime INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                frontmatter TEXT NOT NULL,
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                type TEXT NOT NULL,
                FOREIGN KEY(source_id) REFERENCES nodes(id) ON DELETE CASCADE,
                FOREIGN KEY(target_id) REFERENCES nodes(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS backlinks (
                id TEXT PRIMARY KEY,
                target_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                context TEXT NOT NULL,
                FOREIGN KEY(target_id) REFERENCES nodes(id) ON DELETE CASCADE,
                FOREIGN KEY(source_id) REFERENCES nodes(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS unresolved_links (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                target_path TEXT NOT NULL,
                FOREIGN KEY(source_id) REFERENCES nodes(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS diagnostics (
                id TEXT PRIMARY KEY,
                file_id TEXT,
                message TEXT NOT NULL,
                severity TEXT NOT NULL,
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS index_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS graph_layout (
                node_id TEXT PRIMARY KEY,
                x REAL NOT NULL,
                y REAL NOT NULL
            );
            PRAGMA user_version = 1;
            ",
        )
        .map_err(|error| error.to_string())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub title: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub tags: Vec<String>,
    pub properties: serde_json::Value,
    pub links: Vec<String>,
    pub content: String,
    pub is_unresolved: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub relation: String,
}

#[derive(Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LayoutPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutUpdate {
    pub node_id: String,
    pub position: LayoutPosition,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkResult {
    pub source_id: String,
    pub source_title: String,
    pub context: String,
}

#[derive(Serialize)]
pub struct DiagnosticResult {
    pub path: String,
    pub message: String,
    pub severity: String,
}

struct ParsedNote {
    node: Node,
    checksum: String,
    links: Vec<(String, String)>,
}

fn hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    let normalized = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut lines = normalized.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some((candidate, value)) = line.split_once(':') {
            if candidate.trim() == key {
                return Some(value.trim().trim_matches(['\'', '"']).to_string());
            }
        }
    }
    None
}

fn extract_wikilinks(content: &str) -> Vec<(String, String)> {
    let mut result = Vec::new();
    let mut cursor = 0;
    while let Some(open) = content[cursor..].find("[[") {
        let start = cursor + open + 2;
        let Some(close) = content[start..].find("]]") else {
            break;
        };
        let raw = content[start..start + close].trim();
        let target = raw
            .split('|')
            .next()
            .unwrap_or(raw)
            .split('#')
            .next()
            .unwrap_or(raw)
            .trim();
        if !target.is_empty() {
            let line_start = content[..start]
                .rfind('\n')
                .map(|index| index + 1)
                .unwrap_or(0);
            let line_end = content[start + close..]
                .find('\n')
                .map(|index| start + close + index)
                .unwrap_or(content.len());
            result.push((
                target.to_string(),
                content[line_start..line_end].trim().to_string(),
            ));
        }
        cursor = start + close + 2;
    }
    result
}

fn collect_notes(
    directory: &Path,
    vault: &Path,
    output: &mut Vec<ParsedNote>,
) -> Result<(), String> {
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
            if name != ".mnd" && name != ".obsidian" && name != ".git" && name != "node_modules" {
                collect_notes(&path, vault, output)?;
            }
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let relative = path
            .strip_prefix(vault)
            .map_err(|_| "INDEX_PATH_ESCAPE")?
            .to_string_lossy()
            .replace('\\', "/");
        if extension != "md" {
            let node_type = match extension.as_str() {
                "mp4" | "mov" | "mkv" | "webm" | "avi" | "mxf" | "m4v" | "3gp" => "source_video",
                "mp3" | "wav" | "m4a" | "flac" | "ogg" | "opus" | "aac" | "aif" | "aiff" => {
                    "audio_asset"
                }
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" => {
                    "image"
                }
                "fcpxml" | "xml" => "timeline",
                "srt" | "vtt" => "subtitle",
                _ => "asset",
            };
            let modified = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|value| value.as_nanos())
                .unwrap_or(0);
            output.push(ParsedNote {
                checksum: hash(&format!("{relative}:{}:{modified}", metadata.len())),
                node: Node {
                    id: format!("path_{}", &hash(&relative.to_lowercase())[..24]),
                    title: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    path: relative,
                    node_type: node_type.to_string(),
                    tags: vec![node_type.to_string()],
                    properties: serde_json::json!({ "size": metadata.len(), "extension": extension }),
                    links: Vec::new(),
                    content: String::new(),
                    is_unresolved: false,
                },
                links: Vec::new(),
            });
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|error| format!("{relative}:{error}"))?;
        let id = frontmatter_value(&content, "mnd_id")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| format!("path_{}", &hash(&relative.to_lowercase())[..24]));
        let title = frontmatter_value(&content, "title")
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
        let node_type =
            frontmatter_value(&content, "mnd_type").unwrap_or_else(|| "mnd".to_string());
        let links = extract_wikilinks(&content);
        output.push(ParsedNote {
            checksum: hash(&content),
            node: Node {
                id,
                title,
                path: relative,
                node_type,
                tags: Vec::new(),
                properties: serde_json::json!({}),
                links: links.iter().map(|(target, _)| target.clone()).collect(),
                content,
                is_unresolved: false,
            },
            links,
        });
    }
    Ok(())
}

fn clear_index(transaction: &Transaction<'_>) -> Result<(), String> {
    for table in [
        "edges",
        "backlinks",
        "unresolved_links",
        "diagnostics",
        "nodes",
        "files",
    ] {
        transaction
            .execute(&format!("DELETE FROM {table}"), [])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn insert_notes(
    transaction: &Transaction<'_>,
    vault: &Path,
    notes: &[ParsedNote],
) -> Result<usize, String> {
    let mut seen_ids = HashMap::<String, String>::new();
    let mut indexed_paths = HashSet::<String>::new();
    let mut targets = BTreeMap::<String, String>::new();
    for note in notes {
        let file_id = format!("file_{}", &hash(&note.node.path.to_lowercase())[..24]);
        let metadata =
            fs::metadata(vault.join(&note.node.path)).map_err(|error| error.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64)
            .unwrap_or(0);
        transaction
            .execute(
                "INSERT INTO files (id, path, checksum, mtime) VALUES (?1, ?2, ?3, ?4)",
                params![file_id, note.node.path, note.checksum, modified],
            )
            .map_err(|error| error.to_string())?;
        if let Some(first_path) = seen_ids.get(&note.node.id) {
            transaction
                .execute(
                    "INSERT INTO diagnostics (id, file_id, message, severity) VALUES (?1, ?2, ?3, 'error')",
                    params![
                        hash(&format!("duplicate:{}:{}", note.node.id, note.node.path)),
                        file_id,
                        format!("Duplicate mnd_id {} also used by {}", note.node.id, first_path)
                    ],
                )
                .map_err(|error| error.to_string())?;
            continue;
        }
        seen_ids.insert(note.node.id.clone(), note.node.path.clone());
        indexed_paths.insert(note.node.path.clone());
        transaction
            .execute(
                "INSERT INTO nodes (id, file_id, title, content, frontmatter) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![note.node.id, file_id, note.node.title, note.node.content, note.node.node_type],
            )
            .map_err(|error| error.to_string())?;
        let stem = Path::new(&note.node.path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        for key in [
            stem,
            note.node.title.to_lowercase(),
            note.node.path.trim_end_matches(".md").to_lowercase(),
        ] {
            targets.entry(key).or_insert_with(|| note.node.id.clone());
        }
    }

    for note in notes {
        if !indexed_paths.contains(&note.node.path) {
            continue;
        }
        for (target_text, context) in &note.links {
            let key = target_text
                .trim_end_matches(".md")
                .replace('\\', "/")
                .to_lowercase();
            if let Some(target_id) = targets.get(&key) {
                let edge_id = hash(&format!("{}:{target_id}:link", note.node.id));
                transaction
                    .execute(
                        "INSERT OR IGNORE INTO edges (id, source_id, target_id, type) VALUES (?1, ?2, ?3, 'link')",
                        params![edge_id, note.node.id, target_id],
                    )
                    .map_err(|error| error.to_string())?;
                transaction
                    .execute(
                        "INSERT OR IGNORE INTO backlinks (id, target_id, source_id, context) VALUES (?1, ?2, ?3, ?4)",
                        params![edge_id, target_id, note.node.id, context],
                    )
                    .map_err(|error| error.to_string())?;
            } else {
                transaction
                    .execute(
                        "INSERT INTO unresolved_links (id, source_id, target_path) VALUES (?1, ?2, ?3)",
                        params![hash(&format!("{}:{key}", note.node.id)), note.node.id, target_text],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(indexed_paths.len())
}

#[tauri::command]
pub fn rebuild_vault_index(state: State<'_, VaultState>) -> Result<String, String> {
    let vault = active_root(&state)?;
    rebuild_vault_index_path(&vault)
}

pub fn rebuild_vault_index_path(vault: &Path) -> Result<String, String> {
    let mut notes = Vec::new();
    collect_notes(vault, vault, &mut notes)?;
    notes.sort_by(|left, right| left.node.path.cmp(&right.node.path));
    let mut connection = open_database(vault)?;
    initialize_schema(&connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    clear_index(&transaction)?;
    let count = insert_notes(&transaction, vault, &notes)?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO index_metadata (key, value) VALUES ('last_rebuild', ?1)",
            params![chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(format!("Rebuilt {count} files"))
}

fn node_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Node> {
    Ok(Node {
        id: row.get(0)?,
        title: row.get(1)?,
        path: row.get(2)?,
        node_type: row.get(3)?,
        tags: Vec::new(),
        properties: serde_json::json!({}),
        links: Vec::new(),
        content: row.get(4)?,
        is_unresolved: false,
    })
}

#[tauri::command]
pub fn load_graph(state: State<'_, VaultState>) -> Result<GraphData, String> {
    let vault = active_root(&state)?;
    load_graph_path(&vault)
}

pub fn load_graph_path(vault: &Path) -> Result<GraphData, String> {
    let connection = open_database(vault)?;
    initialize_schema(&connection)?;
    let mut node_statement = connection
        .prepare("SELECT n.id, n.title, f.path, n.frontmatter, n.content FROM nodes n JOIN files f ON f.id = n.file_id ORDER BY n.id")
        .map_err(|error| error.to_string())?;
    let nodes = node_statement
        .query_map([], node_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut edge_statement = connection
        .prepare("SELECT id, source_id, target_id, type FROM edges ORDER BY id")
        .map_err(|error| error.to_string())?;
    let edges = edge_statement
        .query_map([], |row| {
            Ok(Edge {
                id: row.get(0)?,
                source: row.get(1)?,
                target: row.get(2)?,
                relation: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(GraphData { nodes, edges })
}

#[tauri::command]
pub fn search_nodes(state: State<'_, VaultState>, query: String) -> Result<Vec<Node>, String> {
    let vault = active_root(&state)?;
    let connection = open_database(&vault)?;
    initialize_schema(&connection)?;
    let mut statement = connection
        .prepare("SELECT n.id, n.title, f.path, n.frontmatter, n.content FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.title LIKE ?1 OR n.content LIKE ?1 ORDER BY n.title LIMIT 200")
        .map_err(|error| error.to_string())?;
    let results = statement
        .query_map(params![format!("%{query}%")], node_from_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(results)
}

#[tauri::command]
pub fn load_backlinks(
    state: State<'_, VaultState>,
    node_id: String,
) -> Result<Vec<BacklinkResult>, String> {
    let vault = active_root(&state)?;
    let connection = open_database(&vault)?;
    initialize_schema(&connection)?;
    let mut statement = connection
        .prepare("SELECT b.source_id, n.title, b.context FROM backlinks b JOIN nodes n ON n.id = b.source_id WHERE b.target_id = ?1 ORDER BY n.title")
        .map_err(|error| error.to_string())?;
    let results = statement
        .query_map(params![node_id], |row| {
            Ok(BacklinkResult {
                source_id: row.get(0)?,
                source_title: row.get(1)?,
                context: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(results)
}

#[tauri::command]
pub fn load_diagnostics(state: State<'_, VaultState>) -> Result<Vec<DiagnosticResult>, String> {
    let vault = active_root(&state)?;
    let connection = open_database(&vault)?;
    initialize_schema(&connection)?;
    let mut statement = connection
        .prepare("SELECT COALESCE(f.path, ''), d.message, d.severity FROM diagnostics d LEFT JOIN files f ON f.id = d.file_id ORDER BY d.severity, f.path")
        .map_err(|error| error.to_string())?;
    let results = statement
        .query_map([], |row| {
            Ok(DiagnosticResult {
                path: row.get(0)?,
                message: row.get(1)?,
                severity: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(results)
}

#[tauri::command]
pub fn get_index_metadata(
    state: State<'_, VaultState>,
    key: String,
) -> Result<Option<String>, String> {
    let vault = active_root(&state)?;
    let connection = open_database(&vault)?;
    initialize_schema(&connection)?;
    connection
        .query_row(
            "SELECT value FROM index_metadata WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_graph_layout(
    state: State<'_, VaultState>,
) -> Result<BTreeMap<String, LayoutPosition>, String> {
    let vault = active_root(&state)?;
    let path = vault.join(".mnd").join("graph-layout.json");
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| format!("INVALID_GRAPH_LAYOUT:{error}"))
}

#[tauri::command]
pub fn save_graph_layout(
    state: State<'_, VaultState>,
    updates: Vec<LayoutUpdate>,
) -> Result<(), String> {
    let vault = active_root(&state)?;
    let mut layout = BTreeMap::new();
    for update in updates {
        if !update.position.x.is_finite() || !update.position.y.is_finite() {
            return Err("INVALID_LAYOUT_POSITION".to_string());
        }
        layout.insert(update.node_id, update.position);
    }
    let content = serde_json::to_vec_pretty(&layout).map_err(|error| error.to_string())?;
    crate::security::atomic_write_vault_file(
        &vault.join(".mnd").join("graph-layout.json"),
        &content,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_metadata_and_wikilinks_are_parsed_without_rewriting_source() {
        let note = "---\nmnd_id: note-one\ntitle: One\ncustom: preserved\n---\nSee [[Two#Heading|alias]].\n";
        assert_eq!(
            frontmatter_value(note, "mnd_id").as_deref(),
            Some("note-one")
        );
        assert_eq!(
            frontmatter_value(note, "custom").as_deref(),
            Some("preserved")
        );
        assert_eq!(extract_wikilinks(note)[0].0, "Two");
    }

    #[test]
    fn sqlite_rebuild_resolves_links_and_records_duplicate_ids() {
        let vault = tempfile::tempdir().expect("temporary vault");
        fs::write(
            vault.path().join("One.md"),
            "---\nmnd_id: one\ntitle: One\n---\n[[Two]]\n",
        )
        .expect("first note");
        fs::write(
            vault.path().join("Two.md"),
            "---\nmnd_id: two\ntitle: Two\n---\nBody\n",
        )
        .expect("second note");
        fs::write(
            vault.path().join("DuplicateA.md"),
            "---\nmnd_id: duplicate\ntitle: Duplicate A\n---\nBody\n",
        )
        .expect("first duplicate note");
        fs::write(
            vault.path().join("DuplicateB.md"),
            "---\nmnd_id: duplicate\ntitle: Duplicate B\n---\nBody\n",
        )
        .expect("second duplicate note");

        let mut notes = Vec::new();
        collect_notes(vault.path(), vault.path(), &mut notes).expect("collect notes");
        notes.sort_by(|left, right| left.node.path.cmp(&right.node.path));
        let mut connection = open_database(vault.path()).expect("open sqlite");
        initialize_schema(&connection).expect("schema");
        let transaction = connection.transaction().expect("transaction");
        clear_index(&transaction).expect("clear");
        assert_eq!(
            insert_notes(&transaction, vault.path(), &notes).expect("insert"),
            3
        );
        transaction.commit().expect("commit");

        let edge_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))
            .expect("edge count");
        let diagnostic_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM diagnostics", [], |row| row.get(0))
            .expect("diagnostic count");
        assert_eq!(edge_count, 1);
        assert_eq!(diagnostic_count, 1);
        assert_eq!(
            fs::read_to_string(vault.path().join("One.md")).expect("source note"),
            "---\nmnd_id: one\ntitle: One\n---\n[[Two]]\n"
        );
    }
}
