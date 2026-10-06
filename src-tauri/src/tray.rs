//! Tray icon with "Показать панель" and "Выход". The strip opens the panel by a click; the tray
//! is the way to open it when the strip is hidden, and the way to quit.

use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

/// Event the webview listens to in order to open the panel.
const SHOW_PANEL_EVENT: &str = "tray://show-panel";
const SHOW_PANEL_ID: &str = "show-panel";
const QUIT_ID: &str = "quit";

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_PANEL_ID => {
            log::info!("[tray] show panel clicked");
            if let Err(err) = app.emit(SHOW_PANEL_EVENT, ()) {
                log::error!("[tray] cannot emit {SHOW_PANEL_EVENT}: {err}");
            }
        }
        QUIT_ID => {
            log::info!("[tray] quit clicked, exiting");
            app.exit(0);
        }
        other => log::warn!("[tray] unknown menu item {other}"),
    }
}

/// Creates the tray icon. Call it from the `setup` hook.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show_panel = MenuItem::with_id(app, SHOW_PANEL_ID, "Показать панель", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_panel, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
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
