package com.jaskaran.conduit;


import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

/**
 * The page sends the whole set each time, so a forgotten server takes its key with it. When the set changes the
 * WebView's remembered certificate decisions are cleared, so one accepted for a forgotten server is checked again.
 */
@CapacitorPlugin(name = "ConduitTls")
public class ConduitTlsPlugin extends Plugin {

    @PluginMethod
    public void trust(PluginCall call) {
        JSArray offered = call.getArray("identities", new JSArray());
        Map<String, String> identities = new HashMap<>();
        try {
            for (int index = 0; index < offered.length(); index++) {
                JSONObject item = offered.getJSONObject(index);
                String id = item.getString("id");
                String publicKey = item.getString("publicKey");
                if (!id.isEmpty() && !publicKey.isEmpty()) identities.put(id, publicKey);
            }
        } catch (org.json.JSONException malformed) {
            call.reject("identities must be a list of { id, publicKey }");
            return;
        }
        ConduitWebViewClient.remember(getContext(), identities);
        if (ConduitWebViewClient.trust(identities)) {
            getActivity().runOnUiThread(() -> getBridge().getWebView().clearSslPreferences());
        }
        call.resolve();
    }
}
