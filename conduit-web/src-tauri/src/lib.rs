//! The desktop shell. It owns the window and, later, the tray, the single
//! instance and the global shortcuts -- never the transcript, the transport or
//! anything a Conduit server is authoritative for. The bundled SolidJS client
//! is the whole of the interface, and it reaches the same HTTPS and WebSocket
//! endpoints the Android client does.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Conduit desktop failed to start");
}
