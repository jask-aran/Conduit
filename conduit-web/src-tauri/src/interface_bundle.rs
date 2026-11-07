//! Live update of the development client's interface: stage and swap, as the Android development client does.
//!
//! The window keeps loading its interface from this machine -- built in, or one taken from the connected server -- so
//! starting stays instant and works with the server away. The page downloads the server's interface (it already knows
//! the routes and the trust) and hands the zip here; it is unpacked beside the others, then swapped in by serving it
//! in place of the built-in one, under the same origin, so storage and the session carry over.
//!
//! A swapped-in interface is on trial until it says it started (`interface_confirm`): one that never does is dropped at
//! the next launch, back to the built-in one. A new installer brings its own interface, so a staged one taken under an
//! older shell is dropped too. Development builds only: a release client must not run what a server hands it.

use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};
use tauri::{
    ipc::{InvokeBody, Request},
    utils::assets::{AssetKey, AssetsIter, CspHash},
    Assets, Context, Manager, Runtime, State, Webview,
};

const DEV_IDENTIFIER: &str = "com.jaskaran.conduit.desktop.dev";

/// Where the staged interfaces live, and which one is served (None: the built-in one).
pub struct Interface {
    root: PathBuf,
    shell: String,
    served: Arc<RwLock<Option<PathBuf>>>,
    built_in: String,
}

struct Staged<R: Runtime> {
    built_in: Box<dyn Assets<R>>,
    served: Arc<RwLock<Option<PathBuf>>>,
}

impl<R: Runtime> Assets<R> for Staged<R> {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let served = self.served.read().ok().and_then(|served| served.clone());
        let Some(dir) = served else { return self.built_in.get(key) };
        let relative = key.as_ref().trim_start_matches('/');
        // Never a file outside the interface's own folder; a missing one is missing (Tauri then tries index.html), not
        // the built-in build's, which would mix two builds in one page.
        if relative.split('/').any(|part| part == ".." || part.contains('\\')) {
            return None;
        }
        fs::read(dir.join(relative)).ok().map(Cow::Owned)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.built_in.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.built_in.csp_hashes(html_path)
    }
}

/// A build is named as the server names it (client-bundle.js): the first 16 hex of its index.html's SHA-256.
fn build_of(index: &[u8]) -> String {
    Sha256::digest(index).iter().take(8).map(|byte| format!("{byte:02x}")).collect()
}

fn valid_build(build: &str) -> bool {
    build.len() == 16 && build.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Serve a staged interface in place of the built-in one, for the development client. Before the app is built.
pub fn wrap<R: Runtime>(context: &mut Context<R>) -> Option<Interface> {
    if context.config().identifier != DEV_IDENTIFIER {
        return None;
    }
    let root = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join(DEV_IDENTIFIER).join("interface");
    let shell = context.package_info().version.to_string();
    let built_in = context.assets().get(&AssetKey::from("index.html")).map(|index| build_of(&index)).unwrap_or_default();
    let served = Arc::new(RwLock::new(chosen(&root, &shell)));
    struct Nothing;
    impl<R: Runtime> Assets<R> for Nothing {
        fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> { None }
        fn iter(&self) -> Box<AssetsIter<'_>> { Box::new(std::iter::empty()) }
        fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> { Box::new(std::iter::empty()) }
    }
    let original = context.set_assets(Box::new(Nothing));
    context.set_assets(Box::new(Staged { built_in: original, served: served.clone() }));
    Some(Interface { root, shell, served, built_in })
}

/// The staged interface to serve at launch: the one last swapped in, if it started and this is the shell it came to.
fn chosen(root: &Path, shell: &str) -> Option<PathBuf> {
    let current = fs::read_to_string(root.join("current")).ok()?.trim().to_string();
    let taken_under = fs::read_to_string(root.join("shell")).unwrap_or_default();
    if root.join("trial").exists() || taken_under.trim() != shell || !valid_build(&current) {
        let _ = fs::remove_file(root.join("current"));
        let _ = fs::remove_file(root.join("trial"));
        return None;
    }
    let dir = root.join(&current);
    dir.join("index.html").exists().then_some(dir)
}

/// The interface showing now: a staged one's build, or the built-in one's.
#[tauri::command]
pub fn interface_build(interface: State<'_, Interface>) -> String {
    let served = interface.served.read().ok().and_then(|served| served.clone());
    served
        .and_then(|dir| dir.file_name().map(|name| name.to_string_lossy().into_owned()))
        .unwrap_or_else(|| interface.built_in.clone())
}

/// Unpack a server's interface (the zip as the body, its build in `x-build`) beside the others; never shows it.
#[tauri::command]
pub async fn interface_stage(interface: State<'_, Interface>, request: Request<'_>) -> Result<String, String> {
    let build = request.headers().get("x-build").and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
    if !valid_build(&build) {
        return Err("Not an interface build.".into());
    }
    let InvokeBody::Raw(zip) = request.body() else { return Err("The interface is sent as bytes.".into()) };
    let target = interface.root.join(&build);
    if target.join("index.html").exists() {
        return Ok(build);
    }
    let partial = interface.root.join(format!("{build}.partial"));
    let _ = fs::remove_dir_all(&partial);
    unzip(zip, &partial).map_err(|error| format!("Could not unpack the interface: {error}"))?;
    if !partial.join("index.html").exists() {
        let _ = fs::remove_dir_all(&partial);
        return Err("The interface has no index.html.".into());
    }
    fs::rename(&partial, &target).map_err(|error| error.to_string())?;
    Ok(build)
}

/// Show a staged interface: served from now on, on trial until it starts, and the window reloaded into it.
#[tauri::command]
pub fn interface_apply<R: Runtime>(webview: Webview<R>, interface: State<'_, Interface>, build: String) -> Result<(), String> {
    let dir = interface.root.join(&build);
    if !valid_build(&build) || !dir.join("index.html").exists() {
        return Err("That interface is not staged.".into());
    }
    let previous = interface_build(interface.clone());
    fs::write(interface.root.join("current"), &build).map_err(|error| error.to_string())?;
    fs::write(interface.root.join("shell"), &interface.shell).map_err(|error| error.to_string())?;
    fs::write(interface.root.join("trial"), b"").map_err(|error| error.to_string())?;
    *interface.served.write().map_err(|_| "poisoned")? = Some(dir);
    // The one shown before stays too: it is the other server's, and switching back to it is then no download.
    if let Ok(entries) = fs::read_dir(&interface.root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.path().is_dir() && name != build && name != previous {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    for window in webview.app_handle().webview_windows().values() {
        let _ = window.reload();
    }
    Ok(())
}

/// This interface started: it is kept at the next launch. Returns the build showing.
#[tauri::command]
pub fn interface_confirm(interface: State<'_, Interface>) -> String {
    let _ = fs::remove_file(interface.root.join("trial"));
    interface_build(interface)
}

/// A plain zip, as the server writes it (client-bundle.js): stored or deflated entries, sizes in the central directory.
fn unzip(zip: &[u8], into: &Path) -> Result<(), String> {
    let u16_at = |at: usize| zip.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).ok_or("truncated");
    let u32_at = |at: usize| zip.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).ok_or("truncated");
    let end = (0..zip.len().saturating_sub(21)).rev().find(|&at| u32_at(at) == Ok(0x06054b50)).ok_or("no end of the zip")?;
    let count = u16_at(end + 10)?;
    let mut at = u32_at(end + 16)?;
    for _ in 0..count {
        if u32_at(at)? != 0x02014b50 {
            return Err("a broken directory".into());
        }
        let (method, packed, size) = (u16_at(at + 10)?, u32_at(at + 20)?, u32_at(at + 24)?);
        let (name_len, extra_len, comment_len) = (u16_at(at + 28)?, u16_at(at + 30)?, u16_at(at + 32)?);
        let local = u32_at(at + 42)?;
        let name = String::from_utf8_lossy(zip.get(at + 46..at + 46 + name_len).ok_or("truncated")?).into_owned();
        at += 46 + name_len + extra_len + comment_len;
        if name.ends_with('/') {
            continue;
        }
        if name.starts_with('/') || name.split('/').any(|part| part == ".." || part.is_empty() || part.contains('\\') || part.contains(':')) {
            return Err(format!("an unsafe name: {name}"));
        }
        let start = local + 30 + u16_at(local + 26)? + u16_at(local + 28)?;
        let data = zip.get(start..start + packed).ok_or("truncated")?;
        let bytes = match method {
            0 => data.to_vec(),
            8 => {
                let mut out = Vec::with_capacity(size);
                flate2::read::DeflateDecoder::new(data).read_to_end(&mut out).map_err(|error| error.to_string())?;
                out
            }
            other => return Err(format!("compression {other}")),
        };
        let path = into.join(&name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, bytes).map_err(|error| error.to_string())?;
    }
    Ok(())
}
