package com.jaskaran.conduit;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.NoSuchAlgorithmException;
import java.security.NoSuchProviderException;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The shell's half of checking who a server is.
 *
 * The page is where an attestation can be checked -- it holds the server
 * records, and WebCrypto is where the Ed25519 verification happens -- and the
 * WebView's certificate callback is where the answer has to be used. Nothing
 * connects those two but this.
 *
 * The page sends the whole set each time rather than adding to it, so a server
 * that re-issued its certificate replaces its old pin instead of leaving it
 * accepted forever, and a server that was forgotten takes its pin with it.
 */
@CapacitorPlugin(name = "ConduitTls")
public class ConduitTlsPlugin extends Plugin {

    /** Conscrypt, under the name the platform registers it as. */
    private static final String PROVIDER = "AndroidOpenSSL";

    /**
     * Check an Ed25519 signature on the shell's behalf.
     *
     * The page would rather do this itself -- it holds the keys and the
     * records -- but `crypto.subtle` only learned Ed25519 in Chromium 137,
     * and a WebView older than that throws "Unrecognized name" instead. So
     * everything that rests on a signature silently stopped working there:
     * not only the certificate pin, but `proveServer`, which is what decides
     * whether an address may be moved to at all.
     *
     * Android has had this since API 33, which is a lower bar than 137, so
     * the shell answers where the page cannot. It verifies and nothing else:
     * no key is held here, no decision is made here, and an answer of false
     * and an answer of "cannot" are told apart by the caller, because a
     * client that cannot check a signature must not behave as though it did.
     */
    @PluginMethod
    public void verify(PluginCall call) {
        JSObject result = new JSObject();
        boolean verified = false;
        try {
            /*
             * Conscrypt under its registered name, and not the unqualified
             * algorithm, because the unqualified name resolves to
             * AndroidKeyStore -- which exists to hand out handles to keys the
             * hardware holds and refuses an encoded one outright. This key is
             * a public half that arrived over the network and belongs in
             * software.
             */
            PublicKey key = KeyFactory.getInstance("Ed25519", PROVIDER)
                .generatePublic(new X509EncodedKeySpec(Base64.decode(call.getString("publicKey", ""), Base64.DEFAULT)));
            Signature verifier = Signature.getInstance("Ed25519", PROVIDER);
            verifier.initVerify(key);
            verifier.update(call.getString("message", "").getBytes(StandardCharsets.UTF_8));
            verified = verifier.verify(Base64.decode(call.getString("signature", ""), Base64.DEFAULT));
        } catch (NoSuchAlgorithmException | NoSuchProviderException absent) {
            /*
             * This platform cannot check the curve at all, which is not the
             * same as checking it and getting a bad answer, and the two must
             * not be confused: one leaves an address for a person to decide
             * about, the other says something else answered.
             *
             * It is the common case rather than the exotic one. API 33 added
             * Ed25519 to the *keystore*, for keys the device generates and
             * holds; software verification of a key that arrived over the
             * network is not offered by any provider on stock Android. On a
             * Pixel image the only services for the curve are
             * `AndroidKeyStore` and `AndroidKeyStoreBCWorkaround`, neither of
             * which will take an encoded public half.
             */
            android.util.Log.w(ConduitWebViewClient.TAG, "this platform has no software Ed25519: " + absent.getMessage());
            result.put("supported", false);
            result.put("verified", false);
            call.resolve(result);
            return;
        } catch (Exception failure) {
            // A key or a signature that cannot be read is one that does not
            // verify. It is not a reason to say the platform cannot check.
            android.util.Log.w(ConduitWebViewClient.TAG, "a signature could not be checked", failure);
            verified = false;
        }
        result.put("supported", true);
        result.put("verified", verified);
        call.resolve(result);
    }

    @PluginMethod
    public void pin(PluginCall call) {
        JSArray offered = call.getArray("fingerprints", new JSArray());
        Set<String> fingerprints = new HashSet<>();
        try {
            List<String> values = offered.toList();
            for (String value : values) if (value != null && !value.isEmpty()) fingerprints.add(value);
        } catch (org.json.JSONException malformed) {
            call.reject("fingerprints must be a list of strings");
            return;
        }
        ConduitWebViewClient.pin(fingerprints);
        call.resolve();
    }
}
