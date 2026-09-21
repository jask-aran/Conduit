//! Where the desktop client's bearer token lives.
//!
//! A browser has a session cookie the server set; an installed client has a
//! token it must hold itself, and holding it in web storage would put it in a
//! file any process running as this user can read. So the token goes to the OS
//! credential store instead -- Windows Credential Manager, encrypted under the
//! signed-in user's DPAPI key -- and the webview only ever asks for it by name.
//!
//! The web half sees three commands and knows nothing about which store
//! answered them, which is the same arrangement Android has with its keystore.

use tauri::{AppHandle, Runtime};

/// The credential store is shared by everything on the machine, so the entry is
/// named for this build's identifier rather than a constant. A development
/// client installed beside the released one is a different application with its
/// own identifier, and therefore its own token: signing out of one does not
/// sign out of the other.
fn entry<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(&app.config().identifier, key).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>, String> {
    match entry(&app, &key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        // Nothing stored is an answer, not a failure: it is what a first launch
        // and a signed-out client both look like.
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
        // Signing out twice is not an error, and the caller wants the same
        // state either way: nothing stored.
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
