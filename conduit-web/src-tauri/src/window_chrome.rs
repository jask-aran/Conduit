//! The native caption in the app's `--frame` and `--foreground` (styles.css), so caption, border and gutter are one
//! continuous colour.

#[cfg(windows)]
pub fn paint_caption<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_UPDATEITEM, SHCNF_FLUSHNOWAIT, SHCNF_PATHW};
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageW, ICON_BIG, ICON_SMALL2, WM_GETICON, WM_SETICON,
    };
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    };

    // COLORREF is 0x00BBGGRR, not the 0xRRGGBB a stylesheet writes.
    const FRAME: u32 = 0x000A_0908; // --frame  #08090A
    const TEXT: u32 = 0x00EA_E8E6; // --foreground  #E6E8EA

    let Ok(handle) = window.hwnd() else { return };
    let hwnd = HWND(handle.0);
    unsafe {
        // Tao supplies the small window icon, but leaves the taskbar icon unset.
        // Reuse that owned handle instead of Explorer's cached executable icon.
        let icon = SendMessageW(hwnd, WM_GETICON, Some(WPARAM(ICON_SMALL2 as usize)), None);
        if icon.0 != 0 {
            SendMessageW(hwnd, WM_SETICON, Some(WPARAM(ICON_BIG as usize)), Some(LPARAM(icon.0)));
        }
        // Updating replaces this file in place; tell Explorer to refresh its
        // cached executable artwork without clearing unrelated app icon caches.
        if let Ok(exe) = std::env::current_exe() {
            let path: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
            SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSHNOWAIT,
                Some(path.as_ptr() as *const c_void), None);
        }
    }
    for (attribute, value) in [
        (DWMWA_CAPTION_COLOR, &FRAME),
        (DWMWA_BORDER_COLOR, &FRAME),
        (DWMWA_TEXT_COLOR, &TEXT),
    ] {
        // Windows 10 builds before 22000 do not know these attributes and say
        // so; the window is still perfectly usable with the system caption.
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                attribute,
                value as *const u32 as *const c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn paint_caption<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}
