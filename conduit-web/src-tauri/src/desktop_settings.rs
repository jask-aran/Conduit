//! The four facts the shell needs before the webview has loaded: whether
//! closing the window means hiding it, whether Conduit starts with Windows,
//! and whether that start is a visible one.
//!
//! They are kept here rather than in the client's own settings because the
//! close handler and the launch path both run before any of that is readable.
//! The webview reads and writes them through two commands and renders them in
//! Settings, so there is one place a person changes them and one place the
//! shell asks.

use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_autostart::ManagerExt;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    /// Closing the window hides it instead of ending the process.
    pub keep_running_in_tray: bool,
    pub launch_at_login: bool,
    /// Only consulted on a launch the autostart entry made.
    pub start_hidden: bool,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self { keep_running_in_tray: true, launch_at_login: false, start_hidden: false }
    }
}

pub struct Store(pub Mutex<DesktopSettings>);

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("desktop.json"))
}

pub fn load<R: Runtime>(app: &AppHandle<R>) -> DesktopSettings {
    // A file that is missing, unreadable or from a future version is not worth
    // failing a launch over: the defaults are the behaviour most people expect.
    path(app)
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn persist<R: Runtime>(app: &AppHandle<R>, settings: &DesktopSettings) -> Result<(), String> {
    let file = path(app).ok_or("No configuration directory for this user.")?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(file, text).map_err(|error| error.to_string())
}

pub fn keep_running_in_tray<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Store>()
        .and_then(|state| state.0.lock().ok().map(|settings| settings.keep_running_in_tray))
        .unwrap_or(true)
}

#[tauri::command]
pub fn desktop_settings(state: State<'_, Store>) -> DesktopSettings {
    *state.0.lock().expect("desktop settings lock")
}

#[tauri::command]
pub fn set_desktop_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Store>,
    settings: DesktopSettings,
) -> Result<DesktopSettings, String> {
    // The OS registration is the authority on launch-at-login, so it is changed
    // first and its failure is reported rather than written down as success.
    let autostart = app.autolaunch();
    if settings.launch_at_login {
        autostart.enable().map_err(|error| error.to_string())?;
    } else {
        autostart.disable().map_err(|error| error.to_string())?;
    }
    persist(&app, &settings)?;
    *state.0.lock().expect("desktop settings lock") = settings;
    Ok(settings)
}
