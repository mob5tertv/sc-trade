//! Tray icon with "Показать панель" and "Выход". The strip opens the panel by a click; the tray
//! is the way to open it when the strip is hidden, and the way to quit. The two words are Russian until
//! the window says which language it speaks (`set_tray_labels`, version 1.3).

use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

/// Event the webview listens to in order to open the panel.
const SHOW_PANEL_EVENT: &str = "tray://show-panel";
const SHOW_PANEL_ID: &str = "show-panel";
const QUIT_ID: &str = "quit";

/// Asks the webview to open the panel: what the tray item "Показать панель" does, and what a second
/// start of the program does through the single-instance plugin (see `run` in `lib.rs`).
pub fn show_panel(app: &AppHandle) {
    if let Err(err) = app.emit(SHOW_PANEL_EVENT, ()) {
        log::error!("[tray] cannot emit {SHOW_PANEL_EVENT}: {err}");
    }
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_PANEL_ID => {
            log::info!("[tray] show panel clicked");
            show_panel(app);
        }
        QUIT_ID => {
            log::info!("[tray] quit clicked, exiting");
            app.exit(0);
        }
        other => log::warn!("[tray] unknown menu item {other}"),
    }
}

const TRAY_ID: &str = "main";

fn build_menu(app: &AppHandle, show_panel: &str, quit: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let show_panel = MenuItem::with_id(app, SHOW_PANEL_ID, show_panel, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, quit, true, None::<&str>)?;
    Menu::with_items(app, &[&show_panel, &quit])
}

/// The words of the tray menu in the language of the window: it sends them once it knows the language
/// and again when the player changes it. The ids of the items stay, so the menu does what it did.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, show_panel: String, quit: String) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Err("no tray icon".to_string());
    };
    let menu = build_menu(&app, &show_panel, &quit).map_err(|err| err.to_string())?;
    tray.set_menu(Some(menu)).map_err(|err| err.to_string())?;
    log::info!("[tray] labels set");
    Ok(())
}

/// Creates the tray icon. Call it from the `setup` hook.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, "Показать панель", "Выход")?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("SC Trade")
        .menu(&menu)
        .on_menu_event(on_menu_event);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    } else {
        log::warn!("[tray] the app has no default icon, the tray icon will be blank");
    }
    builder.build(app)?;
    log::info!("[tray] icon created");
    Ok(())
}
