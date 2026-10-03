//! Keep the main window's placement across ordinary exits and updater relaunches.

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
    /// Windows stores restored outer bounds, even while maximized/minimized.
    /// Old updater snapshots stored inner size and remain readable.
    #[serde(default)]
    outer: bool,
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
    #[cfg(windows)]
    let placement = {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowPlacement, WINDOWPLACEMENT, SW_SHOWMAXIMIZED, WPF_RESTORETOMAXIMIZED};
        let mut native = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe { GetWindowPlacement(HWND(hwnd.0), &mut native) }.map_err(|error| error.to_string())?;
        let rect = native.rcNormalPosition;
        Placement {
            x: rect.left, y: rect.top,
            width: (rect.right - rect.left).max(0) as u32,
            height: (rect.bottom - rect.top).max(0) as u32,
            maximized: native.showCmd == SW_SHOWMAXIMIZED.0 as u32 || native.flags.contains(WPF_RESTORETOMAXIMIZED),
            outer: true,
        }
    };
    #[cfg(not(windows))]
    let placement = {
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let size = window.inner_size().map_err(|error| error.to_string())?;
        Placement {
            x: position.x, y: position.y, width: size.width, height: size.height,
            maximized: window.is_maximized().map_err(|error| error.to_string())?,
            outer: false,
        }
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
    #[cfg(windows)]
    if placement.outer {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPlacement, WINDOWPLACEMENT, SW_SHOWMAXIMIZED, SW_SHOWNORMAL};
        if let Ok(hwnd) = window.hwnd() {
            let native = WINDOWPLACEMENT {
                length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                showCmd: if placement.maximized { SW_SHOWMAXIMIZED.0 as u32 } else { SW_SHOWNORMAL.0 as u32 },
                rcNormalPosition: RECT {
                    left: placement.x, top: placement.y,
                    right: placement.x.saturating_add(placement.width as i32),
                    bottom: placement.y.saturating_add(placement.height as i32),
                },
                ..Default::default()
            };
            unsafe { let _ = SetWindowPlacement(HWND(hwnd.0), &native); }
        }
        return;
    }
    let _ = window.set_size(PhysicalSize::new(placement.width, placement.height));
    let _ = window.set_position(PhysicalPosition::new(placement.x, placement.y));
    if placement.maximized {
        let _ = window.maximize();
    }
}
