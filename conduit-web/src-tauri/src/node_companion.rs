//! The node role on this computer: the background companion that lets a
//! Conduit server act here (plan, "How does the node role run on a desktop?").
//!
//! It is the same `conduit-node` every device runs, bundled with a Node
//! runtime as an app resource (scripts/build-node-companion.mjs), started as a
//! child of this process while "Serve this computer" is on and restarted if it
//! stops. Because the shell keeps running in the tray with the window closed
//! and can start at login, so does the node. Pairing and sharing go through
//! the same CLI, so its settings file is the one truth; the shell only owns
//! the process and the folder picker.

use std::fs::{self, OpenOptions};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct Companion {
    child: Mutex<Option<Child>>,
    wanted: AtomicBool,
    started: AtomicBool,
}

fn bundle_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?.join("companion");
    dir.join("conduit-node.mjs").is_file().then_some(dir)
}

/// The node's own settings, in this app's data: its pairings, shared folders and grants.
fn node_home<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("node"))
}

fn command<R: Runtime>(app: &AppHandle<R>, args: &[&str]) -> Result<Command, String> {
    let dir = bundle_dir(app).ok_or("This build of Conduit does not include the device companion.")?;
    let home = node_home(app).ok_or("No configuration directory for this user.")?;
    let node = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    let mut command = Command::new(node);
    command.arg(dir.join("conduit-node.mjs")).args(args).env("CONDUIT_NODE_HOME", &home).current_dir(&dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: a background helper, not a console popping up.
        command.creation_flags(0x0800_0000);
    }
    Ok(command)
}

/// One CLI command to completion, for pairing and sharing; its words are the error.
fn run_cli<R: Runtime>(app: &AppHandle<R>, args: &[&str]) -> Result<String, String> {
    let output = command(app, args)?.stdin(Stdio::null()).output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

fn spawn_node<R: Runtime>(app: &AppHandle<R>) -> Result<Child, String> {
    let home = node_home(app).ok_or("No configuration directory for this user.")?;
    fs::create_dir_all(&home).map_err(|error| error.to_string())?;
    let log = OpenOptions::new().create(true).append(true).open(home.join("node.log")).map_err(|error| error.to_string())?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;
    let child = command(app, &["run"])?
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(errors)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    hold_with_app(&child);
    Ok(child)
}

/// The node, and everything it starts, ends with the app: Windows does not end
/// a process's children with it, so a node outlived an app that was closed or
/// updated and kept taking the pairing back from its successor's. A job that
/// kills what it holds when its last handle closes -- the app's, as it exits
/// however it exits -- holds the node from the moment it starts.
#[cfg(windows)]
fn hold_with_app(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    // One job for the app's life, kept as an integer (a handle is not Send).
    static JOB: OnceLock<isize> = OnceLock::new();
    let job = *JOB.get_or_init(|| unsafe {
        let Ok(job) = CreateJobObjectW(None, PCWSTR::null()) else { return 0 };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, size).is_err() {
            return 0;
        }
        job.0 as isize
    });
    if job != 0 {
        unsafe {
            let _ = AssignProcessToJobObject(HANDLE(job as *mut _), HANDLE(child.as_raw_handle() as *mut _));
        }
    }
}

/// The node and everything it started: a command left running after the node
/// is gone would finish unseen, while the server reports its outcome unknown.
/// Windows kills one process, not its children, so the tree goes by taskkill.
fn stop_child(companion: &Companion) {
    if let Some(mut child) = companion.child.lock().expect("companion lock").take() {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &child.id().to_string()])
                .creation_flags(0x0800_0000)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Keep the node running while it is wanted: started once, it watches for
/// the rest of the app's life. A node that keeps failing (not paired yet, a
/// server refusing it) is retried with growing pauses rather than in a loop.
pub fn supervise<R: Runtime>(app: &AppHandle<R>, wanted: bool) {
    let companion = app.state::<Companion>();
    companion.wanted.store(wanted, Ordering::SeqCst);
    if companion.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let mut pause = Duration::from_secs(2);
        let mut since = Instant::now();
        loop {
            let companion = app.state::<Companion>();
            if !companion.wanted.load(Ordering::SeqCst) {
                stop_child(&companion);
            } else {
                let mut slot = companion.child.lock().expect("companion lock");
                let exited = match slot.as_mut() {
                    Some(child) => !matches!(child.try_wait(), Ok(None)),
                    None => true,
                };
                if exited {
                    let ran_long = slot.is_some() && since.elapsed() > Duration::from_secs(60);
                    let was_running = slot.take().is_some();
                    if was_running {
                        pause = if ran_long { Duration::from_secs(2) } else { (pause * 2).min(Duration::from_secs(30)) };
                        drop(slot);
                        thread::sleep(pause);
                        continue;
                    }
                    if let Ok(child) = spawn_node(&app) {
                        *slot = Some(child);
                        since = Instant::now();
                    }
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

/// After pairing or sharing: the running node reads its settings at start.
fn restart<R: Runtime>(app: &AppHandle<R>) {
    stop_child(&app.state::<Companion>());
}

/// The app is going away; the node goes with it.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(companion) = app.try_state::<Companion>() {
        companion.wanted.store(false, Ordering::SeqCst);
        stop_child(&companion);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionStatus {
    /// The bundle is in this build at all.
    available: bool,
    serving: bool,
    running: bool,
    /// `conduit-node status`: this computer's name and what each server is shared.
    node: Option<serde_json::Value>,
}

#[tauri::command]
pub fn device_companion_status<R: Runtime>(app: AppHandle<R>, companion: State<'_, Companion>) -> CompanionStatus {
    let running = companion.child.lock().expect("companion lock").as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None)));
    let node = node_status(&app);
    CompanionStatus { available: bundle_dir(&app).is_some(), serving: companion.wanted.load(Ordering::SeqCst), running, node }
}

/// What `conduit-node status` says, read straight from the node's settings (scripts/conduit-node.mjs `status`, the
/// same shape, its keys left out): running the CLI for it took ~300 ms on the window's own thread, which froze the
/// window while it ran, and the sidebar and Settings ask for it often.
fn node_status<R: Runtime>(app: &AppHandle<R>) -> Option<serde_json::Value> {
    use serde_json::{json, Value};
    let home = node_home(app)?;
    let settings: Value = fs::read_to_string(home.join("node.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_else(|| json!({}));
    // Version 1 held one server at the top.
    let pairings = match settings.get("pairings").and_then(Value::as_array) {
        Some(list) => list.clone(),
        None if settings.get("mainUrl").is_some() => vec![json!({ "mainUrl": settings["mainUrl"], "roots": settings.get("roots").cloned().unwrap_or_else(|| json!([])) })],
        None => Vec::new(),
    };
    let flag = |pairing: &Value, key: &str| pairing.get(key).and_then(Value::as_bool).unwrap_or(false);
    let pairings: Vec<Value> = pairings.iter().map(|pairing| {
        let new_folders = pairing.get("newFolders");
        let grant = |key: &str, otherwise: bool| new_folders.and_then(|value| value.get(key)).and_then(Value::as_bool).unwrap_or(otherwise);
        json!({
            "mainUrl": pairing.get("mainUrl").cloned().unwrap_or(Value::Null),
            "nodeId": pairing.get("nodeId").cloned().unwrap_or(Value::Null),
            "routes": pairing.get("routes").cloned().unwrap_or_else(|| json!([])),
            "roots": pairing.get("roots").cloned().unwrap_or_else(|| json!([])),
            "relays": pairing.get("relays").cloned().unwrap_or_else(|| json!([])),
            "relayed": flag(pairing, "relayed"),
            "browse": flag(pairing, "browse"),
            "newFolders": { "write": grant("write", true), "shell": grant("shell", false) },
        })
    }).collect();
    let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    Some(json!({ "name": settings.get("name").cloned().unwrap_or(Value::Null), "host": host, "pairings": pairings }))
}

/// Pair with a server, given the key it handed out and the node id it made.
#[tauri::command]
pub async fn device_companion_pair<R: Runtime>(app: AppHandle<R>, main_url: String, key: String, node_id: String, name: String, via: Option<Vec<String>>) -> Result<String, String> {
    let mut args = vec!["pair", main_url.as_str(), key.as_str(), "--node", node_id.as_str(), name.as_str()];
    let via = via.unwrap_or_default();
    for route in &via {
        args.push("--via");
        args.push(route.as_str());
    }
    let said = run_cli(&app, &args)?;
    restart(&app);
    Ok(said)
}

/// Share a folder this person picks with one server.
#[tauri::command]
pub async fn device_companion_share<R: Runtime>(app: AppHandle<R>, main_url: String, write: bool, shell: bool) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().set_title("Share a folder with Conduit").blocking_pick_folder() else {
        return Ok(None);
    };
    let folder = picked.into_path().map_err(|error| error.to_string())?;
    let folder = folder.to_string_lossy().to_string();
    let mut args = vec!["share", folder.as_str(), "--server", main_url.as_str()];
    if write {
        args.push("--write");
    }
    if shell {
        args.push("--shell");
    }
    run_cli(&app, &args)?;
    restart(&app);
    Ok(Some(folder))
}

#[tauri::command]
pub async fn device_companion_unshare<R: Runtime>(app: AppHandle<R>, main_url: String, path: String) -> Result<(), String> {
    run_cli(&app, &["unshare", &path, "--server", &main_url])?;
    restart(&app);
    Ok(())
}

/// Let one server browse this computer and share the folders it picks, or stop it.
#[tauri::command]
pub async fn device_companion_browse<R: Runtime>(app: AppHandle<R>, main_url: String, on: bool) -> Result<(), String> {
    run_cli(&app, &["browse", if on { "on" } else { "off" }, "--server", &main_url])?;
    restart(&app);
    Ok(())
}

/// What folders shared with one server may do: those mounted from the app, and those it shares by browsing. The node
/// reads it as it shares one, so it needs no restart.
#[tauri::command]
pub async fn device_companion_new_folders<R: Runtime>(app: AppHandle<R>, main_url: String, write: bool, shell: bool) -> Result<(), String> {
    let mut args = vec!["new-folders", "--server", main_url.as_str()];
    if write {
        args.push("--write");
    }
    if shell {
        args.push("--shell");
    }
    run_cli(&app, &args)?;
    Ok(())
}

#[tauri::command]
pub async fn device_companion_unpair<R: Runtime>(app: AppHandle<R>, main_url: String) -> Result<(), String> {
    run_cli(&app, &["unpair", &main_url])?;
    restart(&app);
    Ok(())
}
