mod backup;
mod focus;
mod input_hook;
mod keys;
mod logging;
mod place;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::install_panic_hook();

    tauri::Builder::default()
        // The log plugin goes first so that the other plugins can log during setup.
        .plugin(logging::plugin())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .manage(focus::ForegroundState::default())
        .manage(input_hook::HookController::default())
        .setup(|app| {
            logging::announce_portable_log();
            // Without a tray icon the app still works (the mini bar expands the window), so a failure
            // is logged, not fatal.
            if let Err(err) = tray::setup(app.handle()) {
                log::error!("[tray] cannot create the tray icon: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            logging::set_log_level,
            backup::backup_db,
            focus::remember_foreground,
            focus::restore_foreground,
            place::place_window,
            input_hook::set_trigger_keys
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
