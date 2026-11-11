//! Hands back what `_conduit._tcp` advertised without judging it: which address is usable and whether the identity is
//! paired are the web half's questions. Each browse is bounded so no multicast socket is held for the window's life.

use std::collections::BTreeMap;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use tauri::ipc::Channel;

const SERVICE_TYPE: &str = "_conduit._tcp.local.";
const MIN_TIMEOUT_MS: u64 = 500;
const MAX_TIMEOUT_MS: u64 = 10_000;

#[derive(Clone, Serialize)]
pub struct Advertisement {
    name: String,
    addresses: Vec<String>,
    port: u16,
    id: String,
    #[serde(rename = "publicKey")]
    public_key: String,
}

/// Each server is also sent down `on_found` as it resolves, so a list need not wait out the whole browse.
#[tauri::command]
pub async fn discover_servers(
    timeout_ms: Option<u64>,
    on_found: Channel<Advertisement>,
) -> Result<Vec<Advertisement>, String> {
    let window = Duration::from_millis(timeout_ms.unwrap_or(3_000).clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS));
    tauri::async_runtime::spawn_blocking(move || browse(window, on_found))
        .await
        .map_err(|error| error.to_string())?
}

fn browse(window: Duration, on_found: Channel<Advertisement>) -> Result<Vec<Advertisement>, String> {
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
                let advertisement = Advertisement {
                        // The instance name, not the DNS name: it is what the
                        // machine calls itself, and what a person picks from.
                        name: info.get_fullname().split('.').next().unwrap_or("").replace("\\032", " "),
                        addresses: info.get_addresses().iter().map(|address| address.to_string()).collect(),
                        port: info.get_port(),
                        id: properties.get_property_val_str("id").unwrap_or("").to_string(),
                        public_key: properties.get_property_val_str("key").unwrap_or("").to_string(),
                };
                // A closed channel is a list that stopped looking; the browse
                // finishes anyway and returns everything.
                let _ = on_found.send(advertisement.clone());
                found.insert(info.get_fullname().to_string(), advertisement);
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.shutdown();
    Ok(found.into_values().collect())
}

/// A server's name can be on this network (`lan.example.com` at 192.168.x) though only its address says so.
#[tauri::command]
pub async fn resolve_host(host: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        (host.as_str(), 0)
            .to_socket_addrs()
            .map(|found| found.map(|address| address.ip().to_string()).collect())
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}
