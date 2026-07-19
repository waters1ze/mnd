pub mod commands;
pub mod config;
pub mod index;
pub mod models;
pub mod obsidian;
pub mod security;
pub mod state;
pub mod watcher;
pub mod workflow;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            app.manage(state::VaultState::load(config_dir.join("config.json")));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::select_vault_directory,
            commands::classify_vault_destination,
            commands::preview_vault_initialization,
            commands::initialize_vault,
            commands::read_vault_file,
            commands::atomic_write_vault_file,
            commands::list_vault_directory,
            commands::create_vault_entry,
            commands::rename_vault_entry,
            commands::move_vault_entry,
            commands::duplicate_vault_entry,
            commands::trash_vault_entry,
            commands::reveal_vault_entry,
            index::rebuild_vault_index,
            index::load_graph,
            index::search_nodes,
            index::load_backlinks,
            index::load_diagnostics,
            index::get_index_metadata,
            index::load_graph_layout,
            index::save_graph_layout,
            watcher::start_vault_watcher,
            watcher::stop_vault_watcher,
            obsidian::preview_vault_copy,
            obsidian::copy_vault_safely,
            obsidian::open_vault_in_obsidian,
            config::get_app_config,
            config::set_active_vault,
            config::forget_recent_vault,
            workflow::get_antigravity_info,
            workflow::scan_vault_inventory,
            workflow::run_auto_edit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
