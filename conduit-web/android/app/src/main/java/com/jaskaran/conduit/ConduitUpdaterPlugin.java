package com.jaskaran.conduit;

import android.content.Context;
import android.content.Intent;
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

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
        worker.execute(() -> {
            File part = new File(directory(), target.getName() + ".part");
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
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
                call.reject(error.getMessage() == null ? "Download failed" : error.getMessage());
            } finally {
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

    private static JSObject ready(boolean ready) {
        JSObject result = new JSObject();
        result.put("ready", ready);
        return result;
    }
}
