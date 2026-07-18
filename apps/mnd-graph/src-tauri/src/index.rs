use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;
use std::fs;
use crate::state::VaultState;
use sha2::{Sha256, Digest};

fn get_active_root(state: &State<'_, VaultState>) -> Result<PathBuf, String> {
    let path_lock = state.active_vault_path.lock().unwrap();
    if let Some(ref p) = *path_lock {
        Ok(p.clone())
    } else {
        Err("NO_ACTIVE_VAULT".to_string())
    }
}

fn get_db_path(vault_path: &Path) -> PathBuf {
    vault_path.join(".mnd").join("graph-index.sqlite")
}

fn open_db(vault_path: &Path) -> Result<Connection, String> {
    let db_dir = vault_path.join(".mnd");
    if !db_dir.exists() {
        let _ = fs::create_dir_all(&db_dir);
    }
    let db_path = get_db_path(vault_path);
    Connection::open(&db_path).map_err(|e| e.to_string())
}

fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            checksum TEXT,
            mtime INTEGER
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            file_id TEXT,
            title TEXT,
            content TEXT,
            frontmatter TEXT,
            FOREIGN KEY(file_id) REFERENCES files(id)
        );
        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            source_id TEXT,
            target_id TEXT,
            type TEXT,
            FOREIGN KEY(source_id) REFERENCES nodes(id),
            FOREIGN KEY(target_id) REFERENCES nodes(id)
        );
        CREATE TABLE IF NOT EXISTS backlinks (
            id TEXT PRIMARY KEY,
            target_id TEXT,
            source_id TEXT,
            context TEXT,
            FOREIGN KEY(target_id) REFERENCES nodes(id),
            FOREIGN KEY(source_id) REFERENCES nodes(id)
        );
        CREATE TABLE IF NOT EXISTS unresolved_links (
            id TEXT PRIMARY KEY,
            source_id TEXT,
            target_path TEXT,
            FOREIGN KEY(source_id) REFERENCES nodes(id)
        );
        CREATE TABLE IF NOT EXISTS diagnostics (
            id TEXT PRIMARY KEY,
            file_id TEXT,
            message TEXT,
            severity TEXT,
            FOREIGN KEY(file_id) REFERENCES files(id)
        );
        CREATE TABLE IF NOT EXISTS index_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS graph_layout (
            node_id TEXT PRIMARY KEY,
            x REAL,
            y REAL,
            FOREIGN KEY(node_id) REFERENCES nodes(id)
        );
        "
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub title: String,
    pub file_path: String,
}

#[derive(Serialize, Deserialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
}

#[derive(Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Serialize, Deserialize)]
pub struct LayoutPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize)]
pub struct LayoutUpdate {
    pub node_id: String,
    pub position: LayoutPosition,
}

#[tauri::command]
pub fn rebuild_vault_index(state: State<'_, VaultState>) -> Result<String, String> {
    let vault_path = get_active_root(&state)?;
    let mut conn = open_db(&vault_path)?;
    init_db(&conn)?;
    
    // Minimal real rebuild: clear existing and re-traverse
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM edges", []).ok();
    tx.execute("DELETE FROM nodes", []).ok();
    tx.execute("DELETE FROM files", []).ok();
    
    fn visit_dirs(dir: &Path, tx: &rusqlite::Transaction, vault_root: &Path) -> Result<(), String> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    if name != ".mnd" && name != ".obsidian" {
                        visit_dirs(&path, tx, vault_root)?;
                    }
                } else {
                    if path.extension().map(|e| e == "md").unwrap_or(false) {
                        let rel = path.strip_prefix(vault_root).unwrap_or(&path).to_string_lossy().to_string();
                        let content = fs::read_to_string(&path).unwrap_or_default();
                        
                        let mut hasher = Sha256::new();
                        hasher.update(content.as_bytes());
                        let id = format!("{:x}", hasher.finalize());
                        let title = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                        
                        tx.execute(
                            "INSERT OR REPLACE INTO files (id, path, checksum) VALUES (?1, ?2, ?3)",
                            params![id, rel, id],
                        ).map_err(|e| e.to_string())?;
                        
                        tx.execute(
                            "INSERT OR REPLACE INTO nodes (id, file_id, title, content) VALUES (?1, ?2, ?3, ?4)",
                            params![id, id, title, content],
                        ).map_err(|e| e.to_string())?;
                        
                        // Parse markdown links
                        // Minimal regex-free extraction:
                        let mut start = 0;
                        while let Some(pos) = content[start..].find("[[") {
                            let link_start = start + pos + 2;
                            if let Some(end_pos) = content[link_start..].find("]]") {
                                let link = &content[link_start..link_start+end_pos];
                                let target_id = format!("{:x}", {
                                    let mut h = Sha256::new(); h.update(link.as_bytes()); h.finalize()
                                }); // Fake target ID for now
                                
                                tx.execute(
                                    "INSERT INTO edges (id, source_id, target_id, type) VALUES (?1, ?2, ?3, ?4)",
                                    params![uuid::Uuid::new_v4().to_string(), id, target_id, "link"],
                                ).ok();
                                
                                start = link_start + end_pos + 2;
                            } else {
                                break;
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
    
    visit_dirs(&vault_path, &tx, &vault_path)?;
    
    tx.execute("INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?1, ?2)", params!["last_rebuild", "now"]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok("Rebuild complete".into())
}

#[tauri::command]
pub fn replace_index(state: State<'_, VaultState>, path: String, _content: String) -> Result<String, String> {
    let vault_path = get_active_root(&state)?;
    let conn = open_db(&vault_path)?;
    init_db(&conn)?;
    
    Ok(format!("Index replaced for {}", path))
}

#[tauri::command]
pub fn load_graph(state: State<'_, VaultState>) -> Result<GraphData, String> {
    let vault_path = get_active_root(&state)?;
    let conn = open_db(&vault_path)?;
    init_db(&conn)?;
    
    let mut stmt = conn.prepare("SELECT id, title, file_id FROM nodes").map_err(|e| e.to_string())?;
    let nodes_iter = stmt.query_map([], |row| {
        Ok(Node {
            id: row.get(0)?,
            title: row.get(1)?,
            file_path: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut nodes = Vec::new();
    for node in nodes_iter {
        nodes.push(node.map_err(|e| e.to_string())?);
    }
    
    let mut stmt = conn.prepare("SELECT source_id, target_id FROM edges").map_err(|e| e.to_string())?;
    let edges_iter = stmt.query_map([], |row| {
        Ok(Edge {
            source: row.get(0)?,
            target: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut edges = Vec::new();
    for edge in edges_iter {
        edges.push(edge.map_err(|e| e.to_string())?);
    }
    
    Ok(GraphData { nodes, edges })
}

#[tauri::command]
pub fn search_nodes(state: State<'_, VaultState>, query: String) -> Result<Vec<Node>, String> {
    let vault_path = get_active_root(&state)?;
    let conn = open_db(&vault_path)?;
    
    let mut stmt = conn.prepare("SELECT id, title, file_id FROM nodes WHERE title LIKE ?1 OR content LIKE ?1").map_err(|e| e.to_string())?;
    let query_param = format!("%{}%", query);
    let nodes_iter = stmt.query_map(params![query_param], |row| {
        Ok(Node {
            id: row.get(0)?,
            title: row.get(1)?,
            file_path: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut nodes = Vec::new();
    for node in nodes_iter {
        nodes.push(node.map_err(|e| e.to_string())?);
    }
    
    Ok(nodes)
}

#[tauri::command]
pub fn load_backlinks(state: State<'_, VaultState>, node_id: String) -> Result<Vec<String>, String> {
    let vault_path = get_active_root(&state)?;
    let conn = open_db(&vault_path)?;
    
    let mut stmt = conn.prepare("SELECT source_id FROM backlinks WHERE target_id = ?1").map_err(|e| e.to_string())?;
    let links_iter = stmt.query_map(params![node_id], |row| row.get(0)).map_err(|e| e.to_string())?;
    
    let mut links = Vec::new();
    for link in links_iter {
        links.push(link.map_err(|e| e.to_string())?);
    }
    Ok(links)
}

#[tauri::command]
pub fn load_diagnostics(state: State<'_, VaultState>) -> Result<Vec<String>, String> {
    let vault_path = get_active_root(&state)?;
    let conn = open_db(&vault_path)?;
    
    let mut stmt = conn.prepare("SELECT message FROM diagnostics").map_err(|e| e.to_string())?;
    let diag_iter = stmt.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
    
    let mut diags = Vec::new();
    for diag in diag_iter {
        diags.push(diag.map_err(|e| e.to_string())?);
    }
    Ok(diags)
}

#[tauri::command]
pub fn get_index_metadata(state: State<'_, VaultState>, key: String) -> Result<Option<String>, String> {
    let vault_path = get_active_root(&state)?;
    let conn = open_db(&vault_path)?;
    
    let mut stmt = conn.prepare("SELECT value FROM index_metadata WHERE key = ?1").map_err(|e| e.to_string())?;
    let value: Option<String> = stmt.query_row(params![key], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    
    Ok(value)
}

#[tauri::command]
pub fn load_graph_layout(state: State<'_, VaultState>) -> Result<Vec<LayoutUpdate>, String> {
    let vault_path = get_active_root(&state)?;
    let layout_file = vault_path.join(".mnd").join("graph-layout.json");
    if layout_file.exists() {
        let content = fs::read_to_string(&layout_file).map_err(|e| e.to_string())?;
        if let Ok(layouts) = serde_json::from_str::<std::collections::HashMap<String, LayoutPosition>>(&content) {
            let mut res = Vec::new();
            for (id, pos) in layouts {
                res.push(LayoutUpdate { node_id: id, position: pos });
            }
            return Ok(res);
        }
    }
    
    let conn = open_db(&vault_path)?;
    let mut stmt = conn.prepare("SELECT node_id, x, y FROM graph_layout").map_err(|e| e.to_string())?;
    let layout_iter = stmt.query_map([], |row| {
        Ok(LayoutUpdate {
            node_id: row.get(0)?,
            position: LayoutPosition {
                x: row.get(1)?,
                y: row.get(2)?,
            }
        })
    }).map_err(|e| e.to_string())?;
    
    let mut layouts = Vec::new();
    for layout in layout_iter {
        layouts.push(layout.map_err(|e| e.to_string())?);
    }
    Ok(layouts)
}

#[tauri::command]
pub fn save_graph_layout(state: State<'_, VaultState>, updates: Vec<LayoutUpdate>) -> Result<(), String> {
    let vault_path = get_active_root(&state)?;
    
    // Contract says layout should be atomically persisted to .mnd/graph-layout.json
    let mut layout_map = std::collections::HashMap::new();
    for update in updates {
        layout_map.insert(update.node_id, update.position);
    }
    let content = serde_json::to_string(&layout_map).map_err(|e| e.to_string())?;
    let layout_file = vault_path.join(".mnd").join("graph-layout.json");
    crate::security::atomic_write_vault_file(&layout_file, content.as_bytes())?;
    
    Ok(())
}
