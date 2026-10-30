package com.jaskaran.conduit;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Download a release APK ahead of time, and hand it to the installer on request.
 *
 * The web half decides whether a release is newer; this only fetches the file
 * into the app's cache and opens the system installer on it. Android checks
 * the APK is signed with the same key as the running app and asks the person
 * before installing, so a file swapped in transit cannot become an update.
 *
 * One APK is kept, named for its version. A finished download is written as
 * `.part` and renamed, so a file under its final name is always complete.
 */
@CapacitorPlugin(name = "ConduitUpdater")
public class ConduitUpdaterPlugin extends Plugin {

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** Set by cancel(): the download under way stops at its next read, and the connection it reads from is closed. */
    private volatile boolean cancelled = false;
    private volatile HttpURLConnection reading = null;

    /** Stop the download under way (an APK or an interface); the call that started it rejects with "Cancelled". */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        HttpURLConnection connection = reading;
        if (connection != null) new Thread(connection::disconnect).start();
        call.resolve(new JSObject());
    }

    private void checkCancelled() {
        if (cancelled) throw new IllegalStateException("Cancelled");
    }

    private void report(String event, String phase, long downloaded, long total) {
        JSObject progress = new JSObject();
        progress.put("phase", phase);
        progress.put("downloaded", downloaded);
        progress.put("total", Math.max(total, 0));
        notifyListeners(event, progress);
    }

    private File directory() {
        File dir = new File(getContext().getCacheDir(), "updates");
        dir.mkdirs();
        return dir;
    }

    private File apk(String version) {
        return new File(directory(), "conduit-" + version.replaceAll("[^0-9A-Za-z.\\-]", "") + ".apk");
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version");
        if (url == null || version == null || !url.startsWith("https://")) {
            call.reject("An https URL and a version are required");
            return;
        }
        File target = apk(version);
        if (target.isFile()) {
            call.resolve(ready(true));
            return;
        }
        // A background check waits for Wi-Fi rather than spend somebody's data.
        ConnectivityManager connectivity = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (call.getBoolean("unmeteredOnly", false) && (connectivity == null || connectivity.isActiveNetworkMetered())) {
            call.resolve(ready(false));
            return;
        }
        cancelled = false;
        worker.execute(() -> {
            File part = new File(directory(), target.getName() + ".part");
            HttpURLConnection connection = null;
            try {
                checkCancelled();
                connection = (HttpURLConnection) new URL(url).openConnection();
                reading = connection;
                // A dev APK comes from the paired hub, which may answer with its own certificate.
                if (connection instanceof javax.net.ssl.HttpsURLConnection) ConduitWebViewClient.trustPaired((javax.net.ssl.HttpsURLConnection) connection);
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(30_000);
                if (connection.getResponseCode() != 200) throw new IllegalStateException("Download failed: HTTP " + connection.getResponseCode());
                long total = connection.getContentLengthLong();
                long downloaded = 0;
                long lastReport = 0;
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] buffer = new byte[64 * 1024];
                    for (int read; (read = in.read(buffer)) > 0; ) {
                        checkCancelled();
                        out.write(buffer, 0, read);
                        downloaded += read;
                        if (downloaded - lastReport >= 512 * 1024) {
                            lastReport = downloaded;
                            JSObject progress = new JSObject();
                            progress.put("downloaded", downloaded);
                            progress.put("total", Math.max(total, 0));
                            notifyListeners("progress", progress);
                        }
                    }
                }
                // Only the newest is worth keeping.
                File[] old = directory().listFiles();
                if (old != null) for (File file : old) if (!file.equals(part)) file.delete();
                if (!part.renameTo(target)) throw new IllegalStateException("Could not keep the download");
                call.resolve(ready(true));
            } catch (Exception error) {
                part.delete();
                call.reject(cancelled ? "Cancelled" : error.getMessage() == null ? "Download failed" : error.getMessage());
            } finally {
                reading = null;
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        String version = call.getString("version");
        File target = version == null ? null : apk(version);
        if (target == null || !target.isFile()) {
            call.reject("No downloaded update for " + version);
            return;
        }
        Context context = getContext();
        // Sideloading needs a one-time per-app grant; send them to it, and
        // the next attempt goes straight through.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent grant = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
            grant.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(grant);
            JSObject result = new JSObject();
            result.put("needsPermission", true);
            call.resolve(result);
            return;
        }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", target);
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(uri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(install);
        call.resolve(new JSObject());
    }

    // --- Live update of the interface (development builds) -----------------
    //
    // The app launches from the interface on the device; this only swaps in a
    // newer one the server offers, after it is downloaded and unpacked whole.
    // A swapped-in interface has to say it started (confirmBundle) within two
    // launches, or MainActivity puts the bundled one back.

    static final String BUNDLE_PREFS = "ConduitBundle";
    static final String PENDING = "pending";
    static final String LAUNCHES = "pendingLaunches";

    private File bundles() {
        File dir = new File(getContext().getFilesDir(), "bundles");
        dir.mkdirs();
        return dir;
    }

    /** The build the app is showing: a downloaded one, or the bundled one's. */
    private String currentBuild() throws Exception {
        String path = getBridge().getServerBasePath();
        if (path != null && !path.isEmpty() && new File(path).getParentFile() != null
                && new File(path).getParentFile().equals(bundles())) return new File(path).getName();
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try (InputStream in = getContext().getAssets().open("public/index.html")) {
            byte[] buffer = new byte[16 * 1024];
            for (int read; (read = in.read(buffer)) > 0; ) sha.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : sha.digest()) hex.append(String.format("%02x", b));
        return hex.substring(0, 16);
    }

    private HttpURLConnection get(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        if (connection instanceof javax.net.ssl.HttpsURLConnection) ConduitWebViewClient.trustPaired((javax.net.ssl.HttpsURLConnection) connection);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(30_000);
        reading = connection;
        if (connection.getResponseCode() != 200) throw new IllegalStateException("HTTP " + connection.getResponseCode() + " for " + url);
        return connection;
    }

    /** Fetch the server's interface if it differs from the one showing; never applies it. */
    @PluginMethod
    public void stageBundle(PluginCall call) {
        String origin = call.getString("origin");
        if (origin == null || !(origin.startsWith("https://") || origin.startsWith("http://"))) {
            call.reject("A server origin is required");
            return;
        }
        cancelled = false;
        worker.execute(() -> {
            File part = null;
            try {
                checkCancelled();
                report("bundleProgress", "checking", 0, 0);
                String manifest;
                HttpURLConnection connection = get(origin + "/client-bundle/manifest.json");
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                    StringBuilder text = new StringBuilder();
                    for (String line; (line = reader.readLine()) != null; ) text.append(line);
                    manifest = text.toString();
                } finally { connection.disconnect(); }
                String build = new org.json.JSONObject(manifest).getString("build");
                if (!build.matches("[0-9a-f]{16}")) throw new IllegalStateException("Unexpected build name");
                JSObject result = new JSObject();
                result.put("build", build);
                String current = currentBuild();
                if (build.equals(current)) { result.put("state", "current"); call.resolve(result); return; }
                File target = new File(bundles(), build);
                if (!new File(target, "index.html").isFile()) {
                    part = new File(bundles(), build + ".part");
                    deleteTree(part);
                    part.mkdirs();
                    String root = part.getCanonicalPath() + File.separator;
                    connection = get(origin + "/client-bundle/" + build + ".zip");
                    long total = connection.getContentLengthLong();
                    report("bundleProgress", "downloading", 0, total);
                    long[] counted = { 0, 0 };
                    InputStream counting = new java.io.FilterInputStream(connection.getInputStream()) {
                        @Override public int read(byte[] b, int off, int len) throws java.io.IOException {
                            if (cancelled) throw new java.io.IOException("Cancelled");
                            int read = super.read(b, off, len);
                            if (read > 0) {
                                counted[0] += read;
                                if (counted[0] - counted[1] >= 128 * 1024) { counted[1] = counted[0]; report("bundleProgress", "downloading", counted[0], total); }
                            }
                            return read;
                        }
                    };
                    try (ZipInputStream zip = new ZipInputStream(counting)) {
                        byte[] buffer = new byte[64 * 1024];
                        for (ZipEntry entry; (entry = zip.getNextEntry()) != null; ) {
                            File out = new File(part, entry.getName());
                            // Nothing may land outside the bundle's own folder.
                            if (!out.getCanonicalPath().startsWith(root)) throw new IllegalStateException("Bad path in bundle");
                            if (entry.isDirectory()) { out.mkdirs(); continue; }
                            out.getParentFile().mkdirs();
                            try (OutputStream file = new FileOutputStream(out)) {
                                for (int read; (read = zip.read(buffer)) > 0; ) file.write(buffer, 0, read);
                            }
                        }
                    } finally { connection.disconnect(); }
                    if (!new File(part, "index.html").isFile()) throw new IllegalStateException("Bundle has no index.html");
                    deleteTree(target);
                    if (!part.renameTo(target)) throw new IllegalStateException("Could not keep the bundle");
                    part = null;
                }
                // Keep this one and the one showing; nothing older.
                File[] all = bundles().listFiles();
                if (all != null) for (File dir : all) if (!dir.getName().equals(build) && !dir.getName().equals(current)) deleteTree(dir);
                result.put("state", "staged");
                call.resolve(result);
            } catch (Exception error) {
                if (part != null) deleteTree(part);
                call.reject(cancelled ? "Cancelled" : error.getMessage() == null ? "Live update failed" : error.getMessage());
            } finally {
                reading = null;
            }
        });
    }

    /** Switch to a staged interface now: the page reloads from it. */
    @PluginMethod
    public void applyBundle(PluginCall call) {
        String build = call.getString("build");
        File target = build == null ? null : new File(bundles(), build);
        if (target == null || !build.matches("[0-9a-f]{16}") || !new File(target, "index.html").isFile()) {
            call.reject("No staged bundle " + build);
            return;
        }
        String path = target.getAbsolutePath();
        getContext().getSharedPreferences(BUNDLE_PREFS, Context.MODE_PRIVATE).edit().putString(PENDING, path).remove(LAUNCHES).commit();
        getContext().getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, path).commit();
        call.resolve(new JSObject());
        getActivity().runOnUiThread(() -> getBridge().setServerBasePath(path));
    }

    /** The interface started: keep it for the next launch. */
    @PluginMethod
    public void confirmBundle(PluginCall call) {
        getContext().getSharedPreferences(BUNDLE_PREFS, Context.MODE_PRIVATE).edit().remove(PENDING).remove(LAUNCHES).commit();
        JSObject result = new JSObject();
        try { result.put("build", currentBuild()); } catch (Exception ignored) { }
        call.resolve(result);
    }

    /**
     * Called before the bridge exists: an interface that started twice without confirming is dropped. One launch is
     * not enough to judge it: one swapped in while the app was in the background, and the app killed there before the
     * page ran, never had the chance, and dropping it put the app back on the interface its APK was built with.
     */
    static void revertUnconfirmed(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(BUNDLE_PREFS, Context.MODE_PRIVATE);
        if (prefs.getString(PENDING, null) == null) return;
        int launches = prefs.getInt(LAUNCHES, 0) + 1;
        if (launches < 2) { prefs.edit().putInt(LAUNCHES, launches).commit(); return; }
        prefs.edit().remove(PENDING).remove(LAUNCHES).commit();
        context.getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE)
            .edit().remove(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH).commit();
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }

    private static JSObject ready(boolean ready) {
        JSObject result = new JSObject();
        result.put("ready", ready);
        return result;
    }
}
