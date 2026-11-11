//! Hex on this computer (github.com/anomalyco/hex): dictation goes to its local API and no audio leaves the device.
//! Hex sends no CORS headers, so the page cannot call it; these commands do, and its bearer token stays here.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

#[derive(Deserialize)]
struct Discovery {
    port: u16,
    token: String,
}

/// A stream's own token: it reaches only that stream, so the page may hold it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    id: u64,
    owner_token: String,
    model: String,
    partials: bool,
}

fn data_folder() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(|folder| PathBuf::from(folder).join("hex"))
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support/hex"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
            .map(|folder| folder.join("hex"))
    }
}

/// Read each time: Hex takes a new port and token whenever it starts.
fn discovery() -> Result<Discovery, String> {
    let file = data_folder().ok_or("No Hex data folder.")?.join("local-api.json");
    let text = std::fs::read_to_string(file).map_err(|_| "Hex is not running on this computer.".to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn connect(hex: &Discovery, wait: Duration) -> Result<TcpStream, String> {
    let stream = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], hex.port)), Duration::from_secs(2))
        .map_err(|_| "Hex is not running on this computer.".to_string())?;
    stream.set_read_timeout(Some(wait)).map_err(|error| error.to_string())?;
    Ok(stream)
}

fn head(hex: &Discovery, method: &str, path: &str, owner: Option<&str>, content: Option<(&str, usize)>) -> String {
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nConnection: close\r\n", hex.port, hex.token);
    if let Some(owner) = owner {
        head.push_str(&format!("X-Hex-Stream-Token: {owner}\r\n"));
    }
    // Hex refuses a request with a body and no length.
    match content {
        Some((kind, length)) => head.push_str(&format!("Content-Type: {kind}\r\nContent-Length: {length}\r\n")),
        None if method == "POST" => head.push_str("Content-Length: 0\r\n"),
        None => {}
    }
    head + "\r\n"
}

/// One request, read to the end. An error status becomes Hex's own code (`stream-busy`, `model-not-loaded`).
fn request(method: &str, path: &str, owner: Option<&str>, body: Option<(&str, &[u8])>, wait: Duration) -> Result<Vec<u8>, String> {
    let hex = discovery()?;
    let mut stream = connect(&hex, wait)?;
    stream.write_all(head(&hex, method, path, owner, body.map(|(kind, bytes)| (kind, bytes.len()))).as_bytes()).map_err(|error| error.to_string())?;
    if let Some((_, bytes)) = body {
        stream.write_all(bytes).map_err(|error| error.to_string())?;
    }
    let mut answer = Vec::new();
    stream.read_to_end(&mut answer).map_err(|error| error.to_string())?;
    let split = answer.windows(4).position(|window| window == b"\r\n\r\n").ok_or("Hex sent no answer.")?;
    let status = std::str::from_utf8(&answer[..split]).ok().and_then(|head| head.split(' ').nth(1)).and_then(|code| code.parse::<u16>().ok()).ok_or("Hex sent no status.")?;
    let content = answer[split + 4..].to_vec();
    if (200..300).contains(&status) {
        return Ok(content);
    }
    let code = serde_json::from_slice::<Value>(&content).ok().and_then(|value| value.get("code").and_then(Value::as_str).map(str::to_string));
    Err(code.unwrap_or_else(|| format!("Hex answered {status}.")))
}

const SHORT: Duration = Duration::from_secs(10);

/// True when a Hex is running here and offers live streams.
#[tauri::command(async)]
pub fn hex_available() -> bool {
    request("GET", "/capabilities", None, None, Duration::from_secs(2))
        .ok()
        .and_then(|body| serde_json::from_slice::<Value>(&body).ok())
        .is_some_and(|value| value.get("streams").and_then(Value::as_bool) == Some(true))
}

/// What Settings shows of the Hex here: `absent` (never run here), `stopped`, `idle` (running, its listening off, so no
/// live streams) or `ready`.
#[derive(Serialize)]
pub struct Status {
    state: &'static str,
    version: Option<String>,
}

#[tauri::command(async)]
pub fn hex_status() -> Status {
    if discovery().is_err() {
        return Status { state: "absent", version: None };
    }
    let read = |path: &str| request("GET", path, None, None, Duration::from_secs(2)).ok().and_then(|body| serde_json::from_slice::<Value>(&body).ok());
    let Some(health) = read("/health") else {
        return Status { state: "stopped", version: None };
    };
    let streams = read("/capabilities").is_some_and(|value| value.get("streams").and_then(Value::as_bool) == Some(true));
    Status { state: if streams { "ready" } else { "idle" }, version: health.get("version").and_then(Value::as_str).map(str::to_string) }
}

/// Opens a live stream on the model Hex's own dictation holds. Hex's events (`partial`, `segment`, `final`, `error`,
/// `cancelled`) arrive on the channel as it sends them, then `{"type":"closed"}`.
#[tauri::command(async)]
pub fn hex_stream_open(on_event: Channel<Value>) -> Result<Stream, String> {
    let created = request("POST", "/streams", None, Some(("application/json", br#"{"sampleFormat":"s16le","sampleRate":16000}"#)), SHORT)?;
    let value: Value = serde_json::from_slice(&created).map_err(|error| error.to_string())?;
    let stream = Stream {
        id: value.get("id").and_then(Value::as_u64).ok_or("Hex opened no stream.")?,
        owner_token: value.get("ownerToken").and_then(Value::as_str).ok_or("Hex opened no stream.")?.to_string(),
        model: value.get("model").and_then(Value::as_str).unwrap_or("").to_string(),
        partials: value.get("partials").and_then(Value::as_bool).unwrap_or(false),
    };
    let hex = discovery()?;
    // Hex sends a keep-alive every 15 s, so a longer silence is a dead connection.
    let mut events = connect(&hex, Duration::from_secs(40))?;
    events.write_all(head(&hex, "GET", &format!("/streams/{}/events", stream.id), Some(&stream.owner_token), None).as_bytes()).map_err(|error| error.to_string())?;
    std::thread::spawn(move || {
        for line in BufReader::new(events).lines() {
            let Ok(line) = line else { break };
            let Some(data) = line.strip_prefix("data:") else { continue };
            if let Ok(event) = serde_json::from_str::<Value>(data.trim()) {
                if on_event.send(event).is_err() {
                    return;
                }
            }
        }
        let _ = on_event.send(serde_json::json!({ "type": "closed" }));
    });
    Ok(stream)
}

/// 16 kHz mono 16-bit samples, base64. Each call renews the stream's 10 s lease.
#[tauri::command(async)]
pub fn hex_stream_audio(id: u64, owner_token: String, audio: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(audio).map_err(|error| error.to_string())?;
    request("POST", &format!("/streams/{id}/audio"), Some(&owner_token), Some(("application/octet-stream", &bytes)), SHORT).map(|_| ())
}

/// Transcribes what is left and answers with the whole text. Hex waits up to 120 s behind its own dictation.
#[tauri::command(async)]
pub fn hex_stream_finish(id: u64, owner_token: String) -> Result<Value, String> {
    let body = request("POST", &format!("/streams/{id}/finish"), Some(&owner_token), None, Duration::from_secs(130))?;
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn hex_stream_cancel(id: u64, owner_token: String) -> Result<(), String> {
    request("POST", &format!("/streams/{id}/cancel"), Some(&owner_token), None, SHORT).map(|_| ())
}
