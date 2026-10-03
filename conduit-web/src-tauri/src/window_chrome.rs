//! The title bar is Windows', but its colour does not have to be. Left alone
//! it paints the system caption above a near-black app, which reads as a
//! second surface stacked on the frame rather than the top of one.
//!
//! These are the same tokens `styles.css` defines -- `--frame` and
//! `--foreground`, converted once to sRGB -- so the caption, the window border
//! and the app's gutter are one continuous colour. Keeping the native caption
//! means the minimise, maximise and close buttons stay where Windows puts them
//! and behave the way every other window does.

#[cfg(windows)]
pub fn paint_caption<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SendMessageW, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, ICON_BIG, ICON_SMALL2, SWP_FRAMECHANGED, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE, WM_GETICON, WM_SETICON,
        WS_EX_DLGMODALFRAME,
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
        // Hide only the caption icon: keep the taskbar icon, resizing and all
        // native window controls. An empty title already removes caption text.
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_DLGMODALFRAME.0 as isize);
        let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
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
