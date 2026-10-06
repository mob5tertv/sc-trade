mod logging;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::install_panic_hook();

    tauri::Builder::default()
        // The log plugin goes first so that the other plugins can log during setup.
        .plugin(logging::plugin())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![logging::set_log_level])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
