use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;
use std::fs;
use std::sync::Mutex;

// --- Stubs for State and Security ---
pub struct AppState {
    pub vault_id: Mutex<Option<String>>,
    pub vault_path: Mutex<Option<PathBuf>>,
}

pub fn get_safe_vault_path(state: &State<AppState>) -> Result<PathBuf, String> {
    let path = state.vault_path.lock().map_err(|e| e.to_string())?;
    if let Some(ref p) = *path {
        Ok(p.clone())
    } else {
        Err("Vault path not set".into())
    }
}

fn get_db_path(vault_path: &Path) -> PathBuf {
    vault_path.join(".mnd").join("graph-index.sqlite")
}

fn open_db(vault_path: &Path) -> Result<Connection, String> {
    let db_dir = vault_path.join(".mnd");
    if !db_dir.exists() {
        fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    }
    let db_path = get_db_path(vault_path);
    Connection::open(&db_path).map_err(|e| e.to_string())
}

// --- Schema Setup ---
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

// --- Data Structures ---

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

// --- Tauri Commands ---

#[tauri::command]
pub fn rebuild_vault_index(state: State<'_, AppState>) -> Result<String, String> {
    let vault_path = get_safe_vault_path(&state)?;
    let conn = open_db(&vault_path)?;
    init_db(&conn)?;
    
    // Stub for actual parsing
    conn.execute("INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?1, ?2)", params!["last_rebuild", "now"]).map_err(|e| e.to_string())?;
    
    Ok("Rebuild complete".into())
}

#[tauri::command]
pub fn replace_index(state: State<'_, AppState>, path: String, _content: String) -> Result<String, String> {
    let vault_path = get_safe_vault_path(&state)?;
    let conn = open_db(&vault_path)?;
    init_db(&conn)?;
    
    // Stub
    Ok(format!("Index replaced for {}", path))
}

#[tauri::command]
pub fn load_graph(state: State<'_, AppState>) -> Result<GraphData, String> {
    let vault_path = get_safe_vault_path(&state)?;
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
pub fn search_nodes(state: State<'_, AppState>, query: String) -> Result<Vec<Node>, String> {
    let vault_path = get_safe_vault_path(&state)?;
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
pub fn load_backlinks(state: State<'_, AppState>, node_id: String) -> Result<Vec<String>, String> {
    let vault_path = get_safe_vault_path(&state)?;
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
pub fn load_diagnostics(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let vault_path = get_safe_vault_path(&state)?;
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
pub fn get_index_metadata(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let vault_path = get_safe_vault_path(&state)?;
    let conn = open_db(&vault_path)?;
    
    let mut stmt = conn.prepare("SELECT value FROM index_metadata WHERE key = ?1").map_err(|e| e.to_string())?;
    let value: Option<String> = stmt.query_row(params![key], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    
    Ok(value)
}

#[tauri::command]
pub fn load_graph_layout(state: State<'_, AppState>) -> Result<Vec<LayoutUpdate>, String> {
    let vault_path = get_safe_vault_path(&state)?;
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
pub fn save_graph_layout(state: State<'_, AppState>, updates: Vec<LayoutUpdate>) -> Result<(), String> {
    let vault_path = get_safe_vault_path(&state)?;
    let mut conn = open_db(&vault_path)?;
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for update in updates {
        tx.execute(
            "INSERT OR REPLACE INTO graph_layout (node_id, x, y) VALUES (?1, ?2, ?3)",
            params![update.node_id, update.position.x, update.position.y],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok(())
}
