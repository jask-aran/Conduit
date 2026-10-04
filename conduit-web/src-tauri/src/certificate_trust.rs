//! Accept a server's self-signed TLS certificate only when a paired server's
//! identity vouches for it -- the Windows half of what
//! `ConduitWebViewClient.java` does on Android.
//!
//! The leaf carries, in a private extension, the server's Ed25519 identity
//! signature over the hash of its own public key (`src/server-tls.js`). The
//! page hands this shell the identity keys of the servers it has paired with;
//! WebView2's `ServerCertificateErrorDetected` asks about each certificate it
//! will not trust by itself, and the answer comes from the certificate and
//! those keys alone.
//!
//! The rule is narrow on purpose. Only an untrusted authority (self-signed)
//! and a name mismatch (the leaf is not re-issued when addresses change) are
//! answered. Validity is checked here from the certificate's own dates, because
//! WebView2 reports one status and an untrusted authority outranks expiry. The
//! natural bug in this file is `ALWAYS_ALLOW` reached by any path that did not
//! verify a signature, and it is worse than no TLS at all.

use std::sync::{LazyLock, RwLock};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Must match `ATTESTATION_PREFIX` in `src/server-tls.js`.
const ATTESTATION_PREFIX: &str = "conduit-leaf-spki-sha256.v1";

/// DER of `ATTESTATION_EXTENSION_OID` in `src/server-tls.js`. Found in the
/// certificate's bytes, as on Android: the arc is a 128-bit UUID.
const ATTESTATION_OID: [u8; 21] = [
    0x06, 0x13, 0x69, 0x85, 0x84, 0xc8, 0xe0, 0xe1, 0xc8, 0xd2, 0x92, 0xc9, 0x8a, 0x9b, 0xb3, 0xe8,
    0x8b, 0xa2, 0x8b, 0x93, 0x7e,
];

/// The DER prefix of an Ed25519 SPKI; the raw key is the 32 bytes after it.
const ED25519_SPKI_PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedIdentity {
    id: String,
    public_key: String,
}

/// Identity id and raw Ed25519 key, for every paired server. Empty refuses.
/// Static because the certificate handler is reached from WebView2, not from
/// anything holding app state.
static IDENTITIES: LazyLock<RwLock<Vec<(String, VerifyingKey)>>> = LazyLock::new(|| RwLock::new(Vec::new()));

/// Replace the whole set. When it changes, WebView2's remembered approvals are
/// cleared, so a certificate accepted for a forgotten server is asked about
/// again rather than still allowed.
#[tauri::command]
pub fn trust_identities(app: tauri::AppHandle, identities: Vec<TrustedIdentity>) -> Result<(), String> {
    let mut next = Vec::new();
    for identity in identities {
        let spki = STANDARD.decode(identity.public_key.as_bytes()).map_err(|_| "publicKey is not base64".to_string())?;
        let raw = spki.strip_prefix(&ED25519_SPKI_PREFIX[..]).ok_or("publicKey is not an Ed25519 SPKI")?;
        let key = VerifyingKey::from_bytes(raw.try_into().map_err(|_| "publicKey is the wrong length")?)
            .map_err(|_| "publicKey is not a valid Ed25519 key")?;
        next.push((identity.id, key));
    }
    next.sort_by(|left, right| left.0.cmp(&right.0));
    let changed = {
        let mut held = IDENTITIES.write().map_err(|_| "trust store poisoned")?;
        let changed = held.iter().map(|(id, key)| (id, key.as_bytes())).ne(next.iter().map(|(id, key)| (id, key.as_bytes())));
        *held = next;
        changed
    };
    if changed {
        clear_remembered(&app);
    }
    Ok(())
}

/// The id of the paired identity that attested this certificate, or None.
fn vouching_identity(der: &[u8]) -> Option<String> {
    let signature = Signature::from_slice(embedded_attestation(der)?).ok()?;
    let hash = STANDARD.encode(Sha256::digest(subject_public_key_info(der)?));
    let held = IDENTITIES.read().ok()?;
    held.iter()
        .find(|(id, key)| key.verify_strict(format!("{ATTESTATION_PREFIX}.{id}.{hash}").as_bytes(), &signature).is_ok())
        .map(|(id, _)| id.clone())
}

/// The 64-byte signature in the attestation extension.
fn embedded_attestation(der: &[u8]) -> Option<&[u8]> {
    let at = der.windows(ATTESTATION_OID.len()).position(|window| window == ATTESTATION_OID)? + ATTESTATION_OID.len();
    // The OCTET STRING wrapping every extension value, then ours.
    if der.get(at..at + 4)? != [0x04, 66, 0x04, 64] {
        return None;
    }
    der.get(at + 4..at + 68)
}

/// One DER element at `at`: (tag, start of contents, end of contents).
fn element(der: &[u8], at: usize) -> Option<(u8, usize, usize)> {
    let tag = *der.get(at)?;
    let first = *der.get(at + 1)? as usize;
    let (length, start) = if first < 0x80 {
        (first, at + 2)
    } else {
        let count = first & 0x7f;
        if count == 0 || count > 4 {
            return None;
        }
        let length = der.get(at + 2..at + 2 + count)?.iter().fold(0usize, |sum, byte| sum << 8 | *byte as usize);
        (length, at + 2 + count)
    };
    let end = start.checked_add(length)?;
    (end <= der.len()).then_some((tag, start, end))
}

/// The certificate's SubjectPublicKeyInfo, whole, as the server hashed it.
fn subject_public_key_info(der: &[u8]) -> Option<&[u8]> {
    let (_, certificate, _) = element(der, 0)?;
    let (_, mut at, _) = element(der, certificate)?;
    // [0] version, if present.
    if der.get(at) == Some(&0xa0) {
        at = element(der, at)?.2;
    }
    // serial, signature algorithm, issuer, validity, subject.
    for _ in 0..5 {
        at = element(der, at)?.2;
    }
    let (_, _, end) = element(der, at)?;
    der.get(at..end)
}

fn der_from_pem(pem: &str) -> Option<Vec<u8>> {
    let body: String = pem.lines().filter(|line| !line.starts_with("-----")).collect();
    STANDARD.decode(body.trim()).ok()
}

/// Install the certificate handler on the main window's WebView2.
#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::ServerCertificateErrorDetectedEventHandler;
    use windows::core::Interface;

    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(core) = core.cast::<ICoreWebView2_14>() else { return };
        let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let allow = decide(&args).unwrap_or(false);
            args.SetAction(if allow {
                COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW
            } else {
                COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL
            })
        }));
        let mut token = Default::default();
        let _ = core.add_ServerCertificateErrorDetected(&handler, &mut token);
    });
}

#[cfg(windows)]
unsafe fn decide(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ServerCertificateErrorDetectedEventArgs,
) -> Option<bool> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;

    let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
    args.ErrorStatus(&mut status).ok()?;
    if status != COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID
        && status != COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT
    {
        return Some(false);
    }
    let certificate = args.ServerCertificate().ok()?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64();
    let (mut valid_from, mut valid_to) = (0f64, 0f64);
    certificate.ValidFrom(&mut valid_from).ok()?;
    certificate.ValidTo(&mut valid_to).ok()?;
    if now < valid_from || now > valid_to {
        return Some(false);
    }
    let mut pem = windows::core::PWSTR::null();
    certificate.ToPemEncoding(&mut pem).ok()?;
    let der = der_from_pem(&webview2_com::take_pwstr(pem))?;
    Some(vouching_identity(&der).is_some())
}

#[cfg(windows)]
fn clear_remembered(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::ClearServerCertificateErrorActionsCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;

    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(core) = core.cast::<ICoreWebView2_14>() else { return };
        let done = ClearServerCertificateErrorActionsCompletedHandler::create(Box::new(|_| Ok(())));
        let _ = core.ClearServerCertificateErrorActions(&done);
    });
}

#[cfg(not(windows))]
fn clear_remembered(_app: &tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    // Issued by `issueLeafCertificate` in `src/server-tls.js`, so these check
    // this reader against the real writer rather than against itself.
    const ID: &str = "5abbb638e71e73e663ec3e1e4f902997";
    const KEY: &str = "MCowBQYDK2VwAyEAdyyVH8vfF1gQ0xnHFn8n+c6Nl3mMjVLojyk0Vez9bsA=";
    const STRANGER: &str = "MCowBQYDK2VwAyEABSR7bgXzKygHInQ6Zp9JYgG7WeujJInbLEq21SPYxcw=";
    const LEAF: &str = "-----BEGIN CERTIFICATE-----\nMIIBuTCCAV+gAwIBAgIQdgUDc6LGFdew4VF9em4TnzAKBggqhkjOPQQDAjAMMQow\nCAYDVQQDDAF0MB4XDTI2MTAwNDAzMzUwNFoXDTI3MTEwNjAzMzUwNFowDDEKMAgG\nA1UEAwwBdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABJRuBefTgwEdjjaFrBVV\nLIWre4LzdYWFvbNoswRxz7HxRpXiN6B3rg/1cX+tH00tyM0W9tS+s7hR4KUVkGv/\nfSCjgaIwgZ8wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAww\nCgYIKwYBBQUHAwEwDwYDVR0RBAgwBocEfwAAATBZBhNphYTI4OHI0pLJipuz6Iui\ni5N+BEIEQHFh5qaplV+Wpr9bJKF577kWwVoXb0kLpGeF/Yiz8xBXZI9Z2DnUZr7u\n8VEG7xTPQxCttXmYb1U5GodejcqeiQ4wCgYIKoZIzj0EAwIDSAAwRQIhAPLeZMM/\nfsxE2Kva+BZ/EAa2sTvIJS6ZZJPiUekMBIlqAiA71LBnhzeBpqoKokd/yzujNrUc\nmatAl0REO84NgH5+ZA==\n-----END CERTIFICATE-----\n";
    const UNATTESTED: &str = "-----BEGIN CERTIFICATE-----\nMIIBXDCCAQOgAwIBAgIRAPbNWh/f517rZ9L4AIQ12uMwCgYIKoZIzj0EAwIwDDEK\nMAgGA1UEAwwBdDAeFw0yNjEwMDQwMzM1MDRaFw0yNzExMDYwMzM1MDRaMAwxCjAI\nBgNVBAMMAXQwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATxVKLZuAMU7UHuGjOF\nqZ3exZk2DQPA4PGIgv54jvhKcUotLrcYiF713SdJU0LUzS0VBcmrl+9tHlnVJm4e\nh2dso0YwRDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAK\nBggrBgEFBQcDATAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0cAMEQCIA/D\nOcLQWytXtFMcO5v1i5kBXUGltGKXDPV90l6zZvj6AiAbw99v9okgU9B42irqZny1\nd36Yyn9HJps7mouaM7i6fA==\n-----END CERTIFICATE-----\n";

    fn trust(id: &str, spki_base64: &str) {
        let spki = STANDARD.decode(spki_base64).unwrap();
        let key = VerifyingKey::from_bytes(spki[ED25519_SPKI_PREFIX.len()..].try_into().unwrap()).unwrap();
        *IDENTITIES.write().unwrap() = vec![(id.to_string(), key)];
    }

    #[test]
    fn only_the_attesting_identity_vouches() {
        let leaf = der_from_pem(LEAF).unwrap();
        trust(ID, KEY);
        assert_eq!(vouching_identity(&leaf).as_deref(), Some(ID));
        assert_eq!(vouching_identity(&der_from_pem(UNATTESTED).unwrap()), None, "no attestation, no trust");

        trust(&"0".repeat(32), KEY);
        assert_eq!(vouching_identity(&leaf), None, "the attestation names its server");
        trust(ID, STRANGER);
        assert_eq!(vouching_identity(&leaf), None, "another key cannot vouch");
    }
}
