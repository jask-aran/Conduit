package com.jaskaran.conduit;


import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Carry the certificates this client has verified down to the WebView.
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
