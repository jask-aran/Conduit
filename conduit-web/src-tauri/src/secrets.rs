//! The bearer token goes to the OS credential store: in web storage it would be in a file any process running as this
//! user can read.

use tauri::{AppHandle, Runtime};

/// Named for this build's identifier, so a development client beside the released one has its own token.
fn entry<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(&app.config().identifier, key).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>, String> {
    match entry(&app, &key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        // Nothing stored is an answer, not a failure: a first launch or a signed-out client.
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn secret_set<R: Runtime>(app: AppHandle<R>, key: String, value: String) -> Result<(), String> {
    entry(&app, &key)?.set_password(&value).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_remove<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    match entry(&app, &key)?.delete_credential() {
        // Signing out twice is not an error.
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
