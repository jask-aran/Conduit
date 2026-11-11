//! Actions that mean something inside the app are handed to the client's command registry, not reimplemented here.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const NEW_CHAT_EVENT: &str = "desktop://new-chat";
pub const CHECK_FOR_UPDATES_EVENT: &str = "desktop://check-for-updates";

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Named for the build, so a development client sitting in the tray beside
    // the released one can be told apart before it is clicked.
    let name = app.config().product_name.clone().unwrap_or_else(|| "Conduit".into());
    let open = MenuItem::with_id(app, "open", format!("Open {name}"), true, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, "new-chat", "New chat", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "check-for-updates", "Check for updates", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &new_chat, &updates, &separator, &quit])?;

    TrayIconBuilder::with_id("conduit")
        .icon(app.default_window_icon().cloned().expect("the bundle ships a window icon"))
        .tooltip(&name)
        .menu(&menu)
        // Left click restores the window; the menu is right-click only.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => reveal(app),
            "new-chat" => {
                reveal(app);
                let _ = app.emit(NEW_CHAT_EVENT, ());
            }
            // The window comes back first: an update that reports its result
            // into a hidden window has reported it to nobody.
            "check-for-updates" => {
                reveal(app);
                let _ = app.emit(CHECK_FOR_UPDATES_EVENT, ());
            }
            // Global shortcuts are released before the process ends, so no chord is left claimed by nothing.
            "quit" => {
                crate::global_shortcuts::release(app);
                app.exit(0)
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Shown, unminimized and focused from every path: a restore left behind another window reads as a launch that did
/// nothing.
pub fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
