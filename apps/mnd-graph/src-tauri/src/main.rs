// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    if let Some(command_index) = args.iter().position(|argument| argument == "--cmd") {
        let command = args
            .get(command_index + 1)
            .map(String::as_str)
            .unwrap_or("");
        if matches!(command, "rebuild" | "status" | "node") {
            let vault = args.get(1).map(std::path::PathBuf::from);
            let result = vault.ok_or_else(|| "vault_not_configured".to_string()).and_then(|vault| {
                if !vault.is_dir() {
                    return Err("vault_not_found".to_string());
                }
                if command == "rebuild" {
                    let message = app_lib::index::rebuild_vault_index_path(&vault)?;
                    return Ok(serde_json::json!({ "status": "completed", "message": message, "vault": vault }));
                }
                let graph = app_lib::index::load_graph_path(&vault)?;
                if command == "node" {
                    let node_index = args.iter().position(|argument| argument == "--node").ok_or("invalid_node_id")?;
                    let node_id = args.get(node_index + 1).ok_or("invalid_node_id")?;
                    let node = graph.nodes.into_iter().find(|node| &node.id == node_id).ok_or("node_not_found")?;
                    return serde_json::to_value(node).map_err(|error| error.to_string());
                }
                Ok(serde_json::json!({
                    "status": "ready",
                    "vault": vault,
                    "nodes": graph.nodes.len(),
                    "edges": graph.edges.len()
                }))
            });
            match result {
                Ok(value) => println!("{value}"),
                Err(error) => {
                    eprintln!(
                        "{}",
                        serde_json::json!({ "status": "failed", "error": error })
                    );
                    std::process::exit(1);
                }
            }
            return;
        }
    }
    app_lib::run();
}
