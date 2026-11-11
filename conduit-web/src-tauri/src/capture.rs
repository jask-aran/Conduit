//! WebView2 takes the picture itself (CapturePreview), so nothing asks the person which window to share.

use tauri::ipc::Response;

#[cfg(windows)]
#[tauri::command(async)]
pub fn capture_page(window: tauri::WebviewWindow) -> Result<Response, String> {
    use std::sync::mpsc;
    use std::time::Duration;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::System::Com::STREAM_SEEK_SET;
    use windows::Win32::UI::Shell::SHCreateMemStream;

    let (send, receive) = mpsc::channel::<Result<Vec<u8>, String>>();
    let failed = send.clone();
    window
        .with_webview(move |webview| unsafe {
            let started = (|| -> Result<(), String> {
                let core = webview.controller().CoreWebView2().map_err(|error| error.to_string())?;
                let stream = SHCreateMemStream(None).ok_or("No memory stream.")?;
                let written = stream.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                    let bytes = result.and_then(|()| written.Seek(0, STREAM_SEEK_SET, None)).map_err(|error| error.to_string()).map(|()| {
                        let mut bytes = Vec::new();
                        let mut chunk = [0u8; 65536];
                        loop {
                            let mut read = 0u32;
                            let _ = written.Read(chunk.as_mut_ptr().cast(), chunk.len() as u32, Some(&mut read));
                            if read == 0 {
                                break bytes;
                            }
                            bytes.extend_from_slice(&chunk[..read as usize]);
                        }
                    });
                    let _ = send.send(bytes);
                    Ok(())
                }));
                core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler).map_err(|error| error.to_string())
            })();
            if let Err(error) = started {
                let _ = failed.send(Err(error));
            }
        })
        .map_err(|error| error.to_string())?;
    let bytes = receive.recv_timeout(Duration::from_secs(10)).map_err(|_| "The capture did not finish.".to_string())??;
    Ok(Response::new(bytes))
}

#[cfg(not(windows))]
#[tauri::command]
pub fn capture_page() -> Result<Response, String> {
    Err("This shell cannot capture its page.".into())
}
