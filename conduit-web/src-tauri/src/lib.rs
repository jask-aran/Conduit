//! The desktop shell. It owns the window, the tray, the single instance and
//! the launch path -- never the transcript, the transport or anything a
//! Conduit server is authoritative for. The bundled SolidJS client is the whole
//! of the interface, and it reaches the same HTTPS and WebSocket endpoints the
//! Android client does.

mod desktop_settings;
mod secrets;
mod tray;

use std::sync::Mutex;

use tauri::{Manager, WindowEvent};

/// The argument the autostart entry launches Conduit with. It is a request to
/// start hidden, not an instruction: the settings decide whether it is honoured.
const HIDDEN_LAUNCH_ARG: &str = "--hidden";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch is a request to see the window that already exists,
        // never a second process holding a second copy of the same session.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::reveal(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_LAUNCH_ARG]),
        ))
        .setup(|app| {
            let handle = app.handle();
            let settings = desktop_settings::load(handle);
            app.manage(desktop_settings::Store(Mutex::new(settings)));
            tray::install(handle)?;
            let asked_to_hide = std::env::args().any(|argument| argument == HIDDEN_LAUNCH_ARG);
            if asked_to_hide && settings.start_hidden {
                if let Some(window) = app.get_webview_window("main") {
                    window.hide()?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // With the tray on, the close button means "put it away". With
                // it off the button means what it says, and Quit is the only
                // other way out.
                if desktop_settings::keep_running_in_tray(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_remove,
            desktop_settings::desktop_settings,
            desktop_settings::set_desktop_settings
        ])
        .run(tauri::generate_context!())
        .expect("Conduit desktop failed to start");
}
