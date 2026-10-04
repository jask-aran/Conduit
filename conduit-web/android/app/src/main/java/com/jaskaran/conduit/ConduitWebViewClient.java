package com.jaskaran.conduit;

import android.net.http.SslError;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.nio.charset.StandardCharsets;
import com.google.crypto.tink.subtle.Ed25519Verify;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Let through a certificate only when a paired server's identity vouches for it.
 *
 * A Conduit server answers over TLS with a certificate it signed itself, so a
 * WebView reaching it raises `ERR_CERT_AUTHORITY_INVALID` and stops. That is
 * the correct default and it stays the default here: no identities refuses
 * everything. What makes a certificate acceptable is that it carries, in its
 * own extension, the server's Ed25519 identity signature over the hash of its
 * public key -- see `docs/connections.md` and `src/server-tls.js`. The shell
 * holds the identity keys of the servers this client has paired with, so it
 * can decide from the certificate alone, and a re-issued certificate needs
 * nothing new from the page.
 *
 * So the rule is narrow on purpose. The embedded attestation must verify
 * against one of those keys; the only errors it answers are an untrusted
 * authority (self-signed) and a name mismatch (the leaf is not re-issued when
 * the machine's addresses change, and the identity, not the name, is what is
 * checked). An expired or not-yet-valid certificate is still refused. The
 * natural bug in this method is `handler.proceed()` reached by any path that
 * did not verify a signature, and it is worse than having no TLS at all,
 * because it accepts every certificate on every network.
 *
 * The signature is checked with Tink, so this works on every supported API
 * level and whatever security providers the image ships.
 */
public class ConduitWebViewClient extends BridgeWebViewClient {

    public static final String TAG = "ConduitTls";

    /** Must match `ATTESTATION_PREFIX` in `src/server-tls.js`. */
    private static final String ATTESTATION_PREFIX = "conduit-leaf-spki-sha256.v1";

    /**
     * DER of `ATTESTATION_EXTENSION_OID` in `src/server-tls.js`. Found in the
     * certificate's bytes rather than through `getExtensionValue`, whose OID
     * parsing stops at 64-bit arcs and this one is a 128-bit UUID.
     */
    private static final byte[] ATTESTATION_OID = {
        (byte) 0x06, (byte) 0x13, (byte) 0x69, (byte) 0x85, (byte) 0x84, (byte) 0xc8, (byte) 0xe0,
        (byte) 0xe1, (byte) 0xc8, (byte) 0xd2, (byte) 0x92, (byte) 0xc9, (byte) 0x8a, (byte) 0x9b,
        (byte) 0xb3, (byte) 0xe8, (byte) 0x8b, (byte) 0xa2, (byte) 0x8b, (byte) 0x93, (byte) 0x7e,
    };

    /**
     * Identity id to Ed25519 public key (SPKI DER, base64), for every paired
     * server. Empty is a refusal. Held statically because the certificate
     * callback is reached from the WebView rather than from anything holding
     * a server record.
     */
    private static volatile Map<String, String> identities = Collections.emptyMap();

    /** Replace the whole set; reports whether it changed. */
    public static boolean trust(Map<String, String> next) {
        Map<String, String> copy = Collections.unmodifiableMap(new HashMap<>(next));
        boolean changed = !copy.equals(identities);
        identities = copy;
        return changed;
    }

    public ConduitWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        boolean onlyTrustAndName = error != null
            && !error.hasError(SslError.SSL_EXPIRED)
            && !error.hasError(SslError.SSL_NOTYETVALID)
            && !error.hasError(SslError.SSL_DATE_INVALID)
            && !error.hasError(SslError.SSL_INVALID);
        String vouched = onlyTrustAndName ? vouchingIdentity(error) : null;
        Log.w(TAG, "onReceivedSslError"
            + " url=" + (error == null ? "?" : error.getUrl())
            + " primary=" + (error == null ? -1 : error.getPrimaryError())
            + " identity=" + vouched);
        if (vouched != null) handler.proceed();
        else handler.cancel();
    }

    /** The id of the paired identity whose attestation this leaf carries, or null. */
    private static String vouchingIdentity(SslError error) {
        if (error.getCertificate() == null) return null;
        try {
            X509Certificate x509 = error.getCertificate().getX509Certificate();
            if (x509 == null) return null;
            byte[] signature = embeddedAttestation(x509.getEncoded());
            if (signature == null) return null;
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(x509.getPublicKey().getEncoded());
            String hash = Base64.encodeToString(digest, Base64.NO_WRAP);
            for (Map.Entry<String, String> identity : identities.entrySet()) {
                byte[] payload = (ATTESTATION_PREFIX + "." + identity.getKey() + "." + hash).getBytes(StandardCharsets.UTF_8);
                if (ed25519Verify(Base64.decode(identity.getValue(), Base64.DEFAULT), payload, signature)) return identity.getKey();
            }
            return null;
        } catch (Exception failure) {
            // A certificate or key that cannot be read cannot vouch for anything.
            Log.w(TAG, "certificate could not be checked", failure);
            return null;
        }
    }

    /** Ed25519 SubjectPublicKeyInfo: this fixed prefix, then the 32-byte key. */
    private static final byte[] ED25519_SPKI_PREFIX = { 0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00 };

    /**
     * Verified with Tink rather than the platform: on some images the only
     * Ed25519 provider is the keystore wrapper, which accepts nothing but its
     * own keys (the emulator's; the SM-S936B's happens to have another), and
     * before API 33 there is none at all.
     */
    private static boolean ed25519Verify(byte[] spki, byte[] payload, byte[] signature) {
        if (spki.length != ED25519_SPKI_PREFIX.length + 32) return false;
        for (int index = 0; index < ED25519_SPKI_PREFIX.length; index++) if (spki[index] != ED25519_SPKI_PREFIX[index]) return false;
        try {
            new Ed25519Verify(Arrays.copyOfRange(spki, ED25519_SPKI_PREFIX.length, spki.length)).verify(signature, payload);
            return true;
        } catch (GeneralSecurityException mismatch) {
            return false;
        }
    }

    /** The 64-byte signature in the attestation extension, or null. */
    private static byte[] embeddedAttestation(byte[] der) {
        outer:
        for (int at = 0; at <= der.length - ATTESTATION_OID.length; at++) {
            for (int index = 0; index < ATTESTATION_OID.length; index++) {
                if (der[at + index] != ATTESTATION_OID[index]) continue outer;
            }
            int value = at + ATTESTATION_OID.length;
            // The OCTET STRING wrapping every extension value, then ours.
            if (value + 4 + 64 > der.length) return null;
            if (der[value] != 0x04 || der[value + 1] != 66 || der[value + 2] != 0x04 || der[value + 3] != 64) return null;
            return Arrays.copyOfRange(der, value + 4, value + 4 + 64);
        }
        return null;
    }
}
