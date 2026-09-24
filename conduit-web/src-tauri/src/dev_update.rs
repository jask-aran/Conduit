//! Check a development update through the route selected for its Conduit server.

use serde::Serialize;
use tauri::{Manager, Runtime, Url, Webview};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: u32,
    current_version: String,
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[tauri::command]
pub async fn check_dev_update<R: Runtime>(
    webview: Webview<R>,
    endpoint: String,
) -> Result<Option<UpdateMetadata>, String> {
    if webview.app_handle().config().identifier != "com.jaskaran.conduit.desktop.dev" {
        return Err("Only the development client can use a server update route.".into());
    }

    let endpoint = Url::parse(&endpoint).map_err(|error| error.to_string())?;
    if !matches!(endpoint.scheme(), "http" | "https")
        || endpoint.path() != "/desktop-updates/latest.json"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err("Invalid development update endpoint.".into());
    }

    let updater = webview
        .updater_builder()
        .endpoints(vec![endpoint.clone()])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    let Some(mut update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };

    // The manifest is signed indirectly through the archive signature, but
    // its URL may name the public route. Download the same named archive from
    // the route that supplied the manifest, then let the updater verify it.
    let archive = update
        .download_url
        .path_segments()
        .and_then(|parts| parts.last())
        .filter(|name| name.ends_with(".nsis.zip"))
        .ok_or("Invalid development update archive URL.")?;
    update.download_url = endpoint.join(archive).map_err(|error| error.to_string())?;

    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(Some(metadata))
}
