package com.jaskaran.conduit;


import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
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
     * Replace the set of leaf fingerprints the WebView may accept.
     *
     * Only fingerprints the page has already verified against a server's
     * identity key arrive here; this holds no keys and makes no decision.
     */
    @PluginMethod
    public void pin(PluginCall call) {
        JSArray offered = call.getArray("fingerprints", new JSArray());
        Set<String> fingerprints = new HashSet<>();
        try {
            for (int index = 0; index < offered.length(); index++) {
                Object value = offered.get(index);
                if (!(value instanceof String)) throw new org.json.JSONException("not a string");
                if (!((String) value).isEmpty()) fingerprints.add((String) value);
            }
        } catch (org.json.JSONException malformed) {
            call.reject("fingerprints must be a list of strings");
            return;
        }
        ConduitWebViewClient.pin(fingerprints);
        call.resolve();
    }
}
