pub mod models;
pub mod state;
pub mod commands;
pub mod security;

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
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        commands::select_vault_directory,
        commands::classify_vault_destination,
        commands::preview_vault_initialization,
        commands::initialize_vault,
        commands::atomic_write_vault_file,
        commands::read_vault_file,
        commands::list_vault_directory,
        commands::create_vault_entry,
        commands::rename_vault_entry,
        commands::move_vault_entry,
        commands::duplicate_vault_entry,
        commands::trash_vault_entry,
        commands::reveal_vault_entry,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
