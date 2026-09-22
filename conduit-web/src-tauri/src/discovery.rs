//! Find Conduit servers on the network this machine is on.
//!
//! The shell's half of `discoverServers()`. The server publishes
//! `_conduit._tcp` with its identity id and Ed25519 public half in the TXT
//! record; this browses for it and hands back what was advertised without
//! judging any of it. Which address is usable, and whether the identity is
//! the one already paired with, are the web half's questions -- those rules
//! live in one place and this is not it.
//!
//! Bounded on purpose. The browse runs for the length of the question and the
//! daemon is dropped with it, rather than holding a multicast socket open for
//! the life of the window to answer something nobody asked.

use std::collections::BTreeMap;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;

const SERVICE_TYPE: &str = "_conduit._tcp.local.";
const MIN_TIMEOUT_MS: u64 = 500;
const MAX_TIMEOUT_MS: u64 = 10_000;

/// Exactly what was advertised. Shaped into a server by the client.
#[derive(Serialize)]
pub struct Advertisement {
    name: String,
    addresses: Vec<String>,
    port: u16,
    id: String,
    #[serde(rename = "publicKey")]
    public_key: String,
}

#[tauri::command]
pub async fn discover_servers(timeout_ms: Option<u64>) -> Result<Vec<Advertisement>, String> {
    let window = Duration::from_millis(timeout_ms.unwrap_or(3_000).clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
    tauri::async_runtime::spawn_blocking(move || browse(window))
        .await
        .map_err(|error| error.to_string())?
}

fn browse(window: Duration) -> Result<Vec<Advertisement>, String> {
    let daemon = ServiceDaemon::new().map_err(|error| error.to_string())?;
    let receiver = daemon.browse(SERVICE_TYPE).map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + window;
    // Keyed by full name so a server that answers on two interfaces, and so
    // resolves twice, is one row rather than two identical ones.
    let mut found: BTreeMap<String, Advertisement> = BTreeMap::new();
    loop {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if left.is_zero() {
            break;
        }
        match receiver.recv_timeout(left) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let properties = info.get_properties();
                found.insert(
                    info.get_fullname().to_string(),
                    Advertisement {
                        // The instance name, not the DNS name: it is what the
                        // machine calls itself, and what a person picks from.
                        name: info.get_fullname().split('.').next().unwrap_or("").replace("\\032", " "),
                        addresses: info.get_addresses().iter().map(|address| address.to_string()).collect(),
                        port: info.get_port(),
                        id: properties.get_property_val_str("id").unwrap_or("").to_string(),
                        public_key: properties.get_property_val_str("key").unwrap_or("").to_string(),
                    },
                );
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    // Best effort: the daemon is going away either way, and a shutdown that
    // fails is not something the person asking "what is on this network" can
    // do anything about.
    let _ = daemon.shutdown();
    Ok(found.into_values().collect())
}
