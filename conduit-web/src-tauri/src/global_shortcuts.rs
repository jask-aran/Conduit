//! Only the OS registration: a chord that fires comes back as the client's command id, so the shell never decides what
//! a key means.

use std::str::FromStr;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::tray;

/// Carries the same command id the client's own registry dispatches on.
pub const COMMAND_EVENT: &str = "desktop://command";

/// The shell reveals the window itself, first, for every command: a hidden window has no visible reaction to offer.
pub const REVEAL_COMMAND: &str = "desktop.reveal";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requested {
    pub accelerator: String,
    pub command_id: String,
}

/// Keyed by the parsed shortcut, not its text, so lookups and unregistration work on what the OS actually holds.
#[derive(Default)]
pub struct Registered(pub Mutex<Vec<(Shortcut, String)>>);

fn parse(shortcuts: &[Requested]) -> Result<Vec<(Shortcut, String)>, String> {
    shortcuts
        .iter()
        .map(|wanted| {
            Shortcut::from_str(&wanted.accelerator)
                .map(|shortcut| (shortcut, wanted.command_id.clone()))
                .map_err(|_| format!("{} is not a shortcut this system understands.", wanted.accelerator))
        })
        .collect()
}

/// Replace the whole set, or change nothing: everything is parsed before anything is registered, and the old set is
/// released only once the new one is held, so a key another application owns leaves the working shortcuts working.
pub fn apply<R: Runtime>(app: &AppHandle<R>, shortcuts: Vec<Requested>) -> Result<(), String> {
    let wanted = parse(&shortcuts)?;
    let manager = app.global_shortcut();
    let state = app.state::<Registered>();
    let held = state.0.lock().expect("global shortcut lock").clone();

    let mut claimed: Vec<Shortcut> = Vec::new();
    for (shortcut, _) in &wanted {
        // A chord this process already holds is not a conflict: it is the same
        // key being kept, so it is released first and taken again.
        let _ = manager.unregister(*shortcut);
        if let Err(error) = manager.register(*shortcut) {
            for taken in claimed {
                let _ = manager.unregister(taken);
            }
            // A refusal costs the new binding and nothing else.
            for (shortcut, _) in &held {
                let _ = manager.register(*shortcut);
            }
            return Err(format!("{shortcut} is already taken by another application ({error})."));
        }
        claimed.push(*shortcut);
    }

    for (shortcut, _) in &held {
        if wanted.iter().any(|(kept, _)| kept == shortcut) {
            continue;
        }
        let _ = manager.unregister(*shortcut);
    }
    *state.0.lock().expect("global shortcut lock") = wanted;
    Ok(())
}

#[tauri::command]
pub fn set_global_shortcuts<R: Runtime>(
    app: AppHandle<R>,
    shortcuts: Vec<Requested>,
) -> Result<(), String> {
    apply(&app, shortcuts)
}

/// Released explicitly on the way out. The OS drops them when the process ends,
/// but Quit is the one exit that has to leave nothing behind.
pub fn release<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.global_shortcut().unregister_all();
    if let Some(state) = app.try_state::<Registered>() {
        if let Ok(mut held) = state.0.lock() {
            held.clear();
        }
    }
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            // Only the press. A chord that acted on press and again on release
            // would open two chats.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let command = app.try_state::<Registered>().and_then(|state| {
                let held = state.0.lock().ok()?;
                held.iter().find(|(held, _)| held == shortcut).map(|(_, command)| command.clone())
            });
            let Some(command) = command else { return };
            tray::reveal(app);
            if command != REVEAL_COMMAND {
                let _ = app.emit(COMMAND_EVENT, command);
            }
        })
        .build()
}
