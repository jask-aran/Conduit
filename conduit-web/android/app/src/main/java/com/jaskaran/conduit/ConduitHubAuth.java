package com.jaskaran.conduit;

import android.content.Context;
import android.util.Base64;
import android.webkit.CookieManager;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONTokener;

/**
 * How native code outside the WebView talks to the hub as the signed-in person: the origin's WebView cookie, and the
 * installed client's bearer token from secure storage. Nothing here is logged: no cookie, token or response body.
 */
final class ConduitHubAuth {
    private ConduitHubAuth() {}

    /** Read the existing secure-storage entry; do not duplicate a native session in plain preferences. */
    static String nativeToken(Context context, String origin) throws Exception {
        // Matches native-auth-client.ts and @aparajita/capacitor-secure-storage's Android AES/GCM format.
        String key = "capacitor-storage_conduit.native.bearer-token." + origin.replaceAll("[^a-zA-Z0-9.\\-]+", "-");
        String stored = context.getSharedPreferences("WSSecureStorageSharedPreferences", Context.MODE_PRIVATE).getString(key, null);
        if (stored == null) return null;
        String[] parts = stored.split("\u0010");
        if (parts.length != 2) return null;
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry entry = store.getEntry(key, null);
        if (!(entry instanceof KeyStore.SecretKeyEntry)) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, ((KeyStore.SecretKeyEntry) entry).getSecretKey(),
            new GCMParameterSpec(128, Base64.decode(parts[1], Base64.DEFAULT)));
        Object value = new JSONTokener(new String(cipher.doFinal(Base64.decode(parts[0], Base64.DEFAULT)), StandardCharsets.UTF_8)).nextValue();
        return value instanceof String && ((String) value).matches("[A-Za-z0-9_-]{32,256}") ? (String) value : null;
    }

    /**
     * An authenticated connection to `origin + path`, not yet connected: redirects off, the paired hub's TLS pin, the
     * origin's cookie when present, and the native session's bearer token when there is one (it wins: a stale cookie
     * from an older shell must not hide the installed client's current session). Throws "Open Conduit to sign in" when
     * there is neither. `tokenOrigin` is the server's stable origin the token is stored under (it can differ from the
     * route being dialled).
     */
    static HttpURLConnection open(Context context, String origin, String tokenOrigin, String path, String method) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(origin + path).openConnection();
        ConduitWebViewClient.restore(context);
        if (connection instanceof javax.net.ssl.HttpsURLConnection)
            ConduitWebViewClient.trustPaired((javax.net.ssl.HttpsURLConnection) connection);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod(method);
        String cookie = CookieManager.getInstance().getCookie(origin);
        boolean hasCookie = cookie != null && !cookie.isEmpty();
        if (hasCookie) connection.setRequestProperty("Cookie", cookie);
        String token = null;
        try { token = nativeToken(context, tokenOrigin == null || tokenOrigin.isEmpty() ? origin : tokenOrigin); }
        catch (Exception error) { if (!hasCookie) throw error; }
        if (token != null) {
            connection.setRequestProperty("Origin", "https://localhost");
            connection.setRequestProperty("Authorization", "Bearer " + token);
        } else if (!hasCookie) throw new IllegalStateException("Open Conduit to sign in");
        return connection;
    }
}
