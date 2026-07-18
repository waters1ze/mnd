pub mod models;
pub mod state;
pub mod security;
pub mod commands;
pub mod index;
pub mod watcher;
pub mod obsidian;
pub mod config;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .manage(state::VaultState::default())
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
        index::replace_index,
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
