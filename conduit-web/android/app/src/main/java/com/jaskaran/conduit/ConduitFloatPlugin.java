package com.jaskaran.conduit;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "ConduitFloat", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class ConduitFloatPlugin extends Plugin {
    static final String PREFS = "conduit-float";
    private boolean permissionFlow;
    private boolean pendingRecord;

    static synchronized SharedPreferences preferences(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("migrated", false)) {
            SharedPreferences.Editor edit = prefs.edit();
            // Read the old store once; an old enabled flag must never re-enable Float later.
            for (java.util.Map.Entry<String, ?> entry : context.getSharedPreferences("conduit-bubble", Context.MODE_PRIVATE).getAll().entrySet()) {
                String key = entry.getKey();
                if (prefs.contains(key)) continue;
                Object value = entry.getValue();
                if (value instanceof Boolean) edit.putBoolean(key, (Boolean) value);
                else if (value instanceof String) edit.putString(key, (String) value);
                else if (value instanceof Integer) edit.putInt(key, (Integer) value);
                else if (value instanceof Float) edit.putFloat(key, (Float) value);
            }
            if (!edit.putBoolean("migrated", true).commit()) throw new IllegalStateException("Could not migrate Float settings");
        }
        return prefs;
    }

    static boolean microphoneGranted(Context context) {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    @Override public void load() {
        try { ConduitMediaVolume.recover(getContext()); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
    }

    private JSObject view() {
        return new JSObject().put("enabled", preferences(getContext()).getBoolean("enabled", false))
            .put("overlayPermission", Settings.canDrawOverlays(getContext()))
            .put("micPermission", microphoneGranted(getContext()))
            .put("holdTarget", "chat".equals(preferences(getContext()).getString("holdTarget", "jbot")) ? "chat" : "jbot")
            .put("holdToTalk", preferences(getContext()).getBoolean("holdToTalk", false));
    }

    @PluginMethod public void status(PluginCall call) { call.resolve(view()); }

    /** Hold to talk (off by default) and what a hold talks to: "jbot", or "chat" for a new chat with no project. */
    @PluginMethod public void setHold(PluginCall call) {
        android.content.SharedPreferences.Editor edit = preferences(getContext()).edit();
        if (call.hasOption("holdToTalk")) edit.putBoolean("holdToTalk", Boolean.TRUE.equals(call.getBoolean("holdToTalk")));
        if (call.hasOption("holdTarget")) {
            String target = call.getString("holdTarget", "jbot");
            if (!"jbot".equals(target) && !"chat".equals(target)) { call.reject("Invalid hold target"); return; }
            edit.putString("holdTarget", target);
        }
        edit.apply();
        call.resolve(view());
    }

    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                saveOrigin(call);
                String otherAudio = call.getString("otherAudio", "keep");
                if (!"keep".equals(otherAudio) && !"lower".equals(otherAudio) && !"mute".equals(otherAudio)) {
                    throw new IllegalArgumentException("Invalid other audio setting");
                }
                preferences(getContext()).edit().putString("otherAudio", otherAudio)
                    .putInt("otherAudioLevel", Math.max(5, Math.min(80, call.getInt("otherAudioLevel", 30)))).apply();
                permissionFlow = true;
                if (!Settings.canDrawOverlays(getContext())) {
                    startActivityForResult(call, overlayIntent(), "overlayReturned");
                } else requireMicrophone(call);
            } catch (Exception error) {
                permissionFlow = false;
                call.reject("Could not start Float", error);
            }
        });
    }

    private void saveOrigin(PluginCall call) {
        // A bundled WebView uses the selected hub address supplied by its HTTP transport.
        String origin = call.getString("origin");
        if (origin == null) origin = getBridge().getWebView().getUrl();
        Uri uri = Uri.parse(origin == null ? "" : origin);
        if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) || uri.getHost() == null
            || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
            || (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))) {
            throw new IllegalArgumentException("Choose a Conduit server first");
        }
        origin = uri.buildUpon().path("").build().toString();
        preferences(getContext()).edit().putString("origin", origin)
            .putString("tokenOrigin", call.getString("tokenOrigin", origin)).apply();
    }

    // Follow hub/path changes without restarting a microphone service from a background WebView.
    @PluginMethod public void setOrigin(PluginCall call) {
        if ("".equals(call.getString("origin"))) {
            preferences(getContext()).edit().remove("origin").remove("tokenOrigin").apply();
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            try { saveOrigin(call); call.resolve(); }
            catch (RuntimeException error) { call.reject("Invalid Conduit server", error); }
        });
    }

    private Intent overlayIntent() {
        return new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
    }

    @ActivityCallback private void overlayReturned(PluginCall call, ActivityResult result) {
        if (call == null) { permissionFlow = false; return; }
        if (!Settings.canDrawOverlays(getContext())) {
            permissionFlow = false;
            call.reject("Allow display over other apps to use Float");
            return;
        }
        requireMicrophone(call);
    }

    private void requireMicrophone(PluginCall call) {
        if (!microphoneGranted(getContext())) requestPermissionForAlias("microphone", call, "microphoneReturned");
        else microphoneReturned(call);
    }

    @PermissionCallback private void microphoneReturned(PluginCall call) {
        permissionFlow = false;
        if (call == null) return;
        if (!microphoneGranted(getContext())) { call.reject("Allow microphone access to use Float"); return; }
        try {
            startVisible(false);
            preferences(getContext()).edit().putBoolean("enabled", true).apply();
            call.resolve(view());
        } catch (RuntimeException error) { call.reject("Could not start Float", error); }
    }

    private void startVisible(boolean record) {
        Intent intent = new Intent(getContext(), ConduitFloatService.class).setAction(ConduitFloatService.VISIBLE)
            .putExtra("record", record);
        if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(intent);
        else getContext().startService(intent);
    }

    @PluginMethod public void stop(PluginCall call) {
        preferences(getContext()).edit().putBoolean("enabled", false).apply();
        getContext().stopService(new Intent(getContext(), ConduitFloatService.class));
        try { ConduitMediaVolume.recover(getContext()); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
        call.resolve(view());
    }

    @PluginMethod public void openOverlaySettings(PluginCall call) {
        getActivity().runOnUiThread(() -> startActivityForResult(call, overlayIntent(), "settingsReturned"));
    }

    @ActivityCallback private void settingsReturned(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(view());
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        pendingRecord |= intent != null && intent.getBooleanExtra("conduit.float.record", false);
    }

    @Override protected void handleOnResume() {
        if (permissionFlow || !preferences(getContext()).getBoolean("enabled", false)
            || !Settings.canDrawOverlays(getContext()) || !microphoneGranted(getContext())) return;
        Intent launch = getActivity().getIntent();
        boolean record = pendingRecord || (launch != null && launch.getBooleanExtra("conduit.float.record", false));
        pendingRecord = false;
        if (record && launch != null) launch.removeExtra("conduit.float.record");
        try { startVisible(record); }
        catch (RuntimeException error) { android.util.Log.w("ConduitFloat", "Open Conduit to restore Float"); }
    }
}
