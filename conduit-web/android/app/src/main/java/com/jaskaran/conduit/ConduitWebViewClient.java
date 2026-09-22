package com.jaskaran.conduit;

import android.net.http.SslError;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Let through exactly the certificate this server's identity attested, and
 * nothing else.
 *
 * A Conduit server answers over TLS with a certificate it signed itself, so a
 * WebView reaching it raises `ERR_CERT_AUTHORITY_INVALID` and stops. That is
 * the correct default and it stays the default here: an empty pin set refuses
 * everything. What makes the certificate acceptable is not that it is ours to
 * begin with but that the server's Ed25519 identity signed the hash of its
 * public key, which a client that has already paired can check -- see
 * `docs/pinned-tls-plan.md`.
 *
 * So the rule is narrow on purpose. The hash of the offered key must already
 * be in the set, the set is written only after an attestation has been
 * verified, and every other error -- an expired certificate, a name that does
 * not match, a chain to anywhere -- is still refused. The natural bug in this
 * method is `handler.proceed()` reached by any path that did not compare a
 * hash, and it is worse than having no TLS at all, because it accepts every
 * certificate on every network.
 */
public class ConduitWebViewClient extends BridgeWebViewClient {

    public static final String TAG = "ConduitTls";

    /**
     * SHA-256 over the SPKI of each key this app will accept, base64.
     *
     * Empty until something verifies an attestation, and empty is a refusal.
     * Held statically because the certificate callback is reached from the
     * WebView rather than from anything holding a server record.
     */
    private static volatile Set<String> pinned = Collections.emptySet();

    /** Replace the whole set, so a server that re-issued cannot be additive. */
    public static void pin(Set<String> fingerprints) {
        pinned = Collections.unmodifiableSet(new HashSet<>(fingerprints));
    }

    public ConduitWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        String offered = fingerprintOf(error);
        boolean known = offered != null && pinned.contains(offered);
        // Only the untrusted-authority case is a self-signed certificate being
        // what it is. An expired one, or one for another name, is a different
        // failure and a pin is not an answer to it.
        boolean selfSignedOnly = error != null && error.getPrimaryError() == SslError.SSL_UNTRUSTED;
        Log.w(TAG, "onReceivedSslError"
            + " url=" + (error == null ? "?" : error.getUrl())
            + " primary=" + (error == null ? -1 : error.getPrimaryError())
            + " spki=" + offered
            + " pinned=" + known);
        if (known && selfSignedOnly) handler.proceed();
        else handler.cancel();
    }

    /** The hash a leaf is known by: SHA-256 over its SPKI, exactly as sent. */
    private static String fingerprintOf(SslError error) {
        if (Build.VERSION.SDK_INT < 29 || error == null || error.getCertificate() == null) return null;
        try {
            X509Certificate x509 = error.getCertificate().getX509Certificate();
            if (x509 == null) return null;
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(x509.getPublicKey().getEncoded());
            return Base64.encodeToString(digest, Base64.NO_WRAP);
        } catch (Exception failure) {
            // A certificate whose key cannot be read is one that cannot match
            // a pin, which is the same outcome as not matching one.
            Log.w(TAG, "certificate could not be read", failure);
            return null;
        }
    }
}
