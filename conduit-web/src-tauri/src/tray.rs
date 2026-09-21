//! The tray is functional chrome, not a second way to navigate Conduit: four
//! actions, and the ones that mean something inside the app are handed to the
//! client's own command registry rather than reimplemented here.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// What the client listens for. One event, one payload-free command name.
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
        // Left click restores the window; the menu is the right-click gesture,
        // so a click never has to be aimed at a menu the person did not want.
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
            // The only way out when the close button hides. The keys the shell
            // took from the whole system are given back before the process
            // ends, so quitting never leaves a chord claimed by nothing.
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

/// One window state, reached the same way from every path: shown, unminimized,
/// focused. A restore that leaves the window behind another one reads as a
/// launch that did nothing.
pub fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
