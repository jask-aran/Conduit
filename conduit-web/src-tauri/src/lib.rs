//! The desktop shell. It owns the window and, later, the tray, the single
//! instance and the global shortcuts -- never the transcript, the transport or
//! anything a Conduit server is authoritative for. The bundled SolidJS client
//! is the whole of the interface, and it reaches the same HTTPS and WebSocket
//! endpoints the Android client does.

mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_remove
        ])
        .run(tauri::generate_context!())
        .expect("Conduit desktop failed to start");
}
