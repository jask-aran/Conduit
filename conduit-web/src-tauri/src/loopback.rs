//! Loopback only; the URL carries an authorization code, so it is never logged.

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, TcpListener};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Each listen takes a new generation; a later listen or a stop moves it on, which ends the older one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

const PAGE: &str = "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>Conduit</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:16px system-ui,sans-serif\"><p>Signed in. Go back to Conduit.</p>";

#[tauri::command]
pub async fn loopback_listen(port: u16) -> Option<String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || serve(port, generation))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub fn loopback_stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

fn serve(port: u16, generation: u64) -> Option<String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).ok()?;
    listener.set_nonblocking(true).ok()?;
    let deadline = Instant::now() + Duration::from_secs(600);
    while GENERATION.load(Ordering::SeqCst) == generation && Instant::now() < deadline {
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(_) => continue,
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        let target = line.split(' ').nth(1).unwrap_or("");
        if !target.starts_with('/') || !target.contains('?') {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        }
        let url = format!("http://localhost:{port}{target}");
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{PAGE}",
                PAGE.len()
            )
            .as_bytes(),
        );
        let _ = stream.flush();
        return Some(url);
    }
    None
}
