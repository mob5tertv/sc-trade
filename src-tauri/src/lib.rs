mod backup;
mod cursor_watch;
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
        // Must be the first plugin: a second start hands over to the running copy and exits while the
        // plugins are set up, before anything of its own (log file, window, hook) exists.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // The command line and the working directory of the second start are not logged: a path
            // in them holds the Windows user name.
            log::info!("[single-instance] a second start asked for the panel");
            tray::show_panel(app);
        }))
        // The log plugin goes right after it so that the other plugins can log during setup.
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
            // Diagnostics only: logs when the game hides or shows the system cursor. Changes nothing.
            // Starts only when `cursor-watch.flag` lies next to the exe.
            cursor_watch::start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            logging::set_log_level,
            backup::backup_db,
            focus::remember_foreground,
            focus::restore_foreground,
            focus::take_foreground,
            focus::panel_is_foreground,
            place::place_window,
            input_hook::set_trigger_keys,
            tray::set_tray_labels
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
