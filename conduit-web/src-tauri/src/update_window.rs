//! Keep the main window where it was when a quiet updater relaunches Conduit.

use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime};

#[derive(Serialize, Deserialize)]
struct Placement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

fn path<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("update-window.json"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remember_update_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable.")?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let maximized = window.is_maximized().map_err(|error| error.to_string())?;
    let placement = Placement {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
    };
    let file = path(&app)?;
    if let Some(directory) = file.parent() {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    fs::write(
        file,
        serde_json::to_vec(&placement).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    let Ok(file) = path(app) else { return };
    let placement = fs::read(&file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Placement>(&bytes).ok());
    let _ = fs::remove_file(file);
    let Some(placement) = placement else { return };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if placement.width < 520 || placement.height < 480 {
        return;
    }
    // An unplugged monitor must not reopen Conduit where it cannot be reached.
    let on_screen = window.available_monitors().ok().is_some_and(|monitors| {
        monitors.iter().any(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let right = i64::from(placement.x) + i64::from(placement.width);
            let bottom = i64::from(placement.y) + i64::from(placement.height);
            right > i64::from(position.x) + 100
                && bottom > i64::from(position.y) + 100
                && i64::from(placement.x) < i64::from(position.x) + i64::from(size.width) - 100
                && i64::from(placement.y) < i64::from(position.y) + i64::from(size.height) - 100
        })
    });
    if !on_screen {
        return;
    }
    let _ = window.set_size(PhysicalSize::new(placement.width, placement.height));
    let _ = window.set_position(PhysicalPosition::new(placement.x, placement.y));
    if placement.maximized {
        let _ = window.maximize();
    }
}
