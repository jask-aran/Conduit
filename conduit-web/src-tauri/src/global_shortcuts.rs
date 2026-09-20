//! The keys Conduit holds while it is not the focused application.
//!
//! The window owns the registry; this owns only the OS registration. The client
//! sends the set it wants, the shell claims it, and a chord that fires comes
//! back as the command id the client already knows how to run -- so there is one
//! list of shortcuts, in the client, and the shell never decides what a key
//! means.

use std::str::FromStr;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::tray;

/// What the client hears when a system-wide key fires: the command id, which is
/// the same string its own registry dispatches on.
pub const COMMAND_EVENT: &str = "desktop://command";

/// The command the shell answers itself. Revealing the window has to happen
/// before the client can be told anything -- a hidden window has no visible
/// reaction to offer -- so the shell does it first, for every command, and the
/// client is told afterwards about whatever else the command means.
pub const REVEAL_COMMAND: &str = "desktop.reveal";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requested {
    pub accelerator: String,
    pub command_id: String,
}

/// The chords currently held, each with the command it stands for. Keyed by the
/// parsed shortcut rather than by the text it was parsed from, so a lookup and
/// an unregistration both work on what the OS actually holds.
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

/// Replace the whole set, or change nothing.
///
/// The order matters: every accelerator is parsed before any is registered, and
/// what was held before is released only once the new set is held. A key that
/// another application already owns therefore leaves the shortcuts that were
/// working still working, and says which one was refused, rather than dropping
/// the person to none at all.
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
            // Whatever was working before this call is put back, so a refusal
            // costs the new binding and nothing else.
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
