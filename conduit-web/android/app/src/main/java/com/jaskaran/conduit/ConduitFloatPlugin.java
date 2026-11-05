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


    /** Conduit holds the assistant role (or, before roles, is the assistant setting). */
    private boolean isAssistant() {
        if (Build.VERSION.SDK_INT >= 29) {
            android.app.role.RoleManager roles = getContext().getSystemService(android.app.role.RoleManager.class);
            return roles != null && roles.isRoleAvailable(android.app.role.RoleManager.ROLE_ASSISTANT)
                && roles.isRoleHeld(android.app.role.RoleManager.ROLE_ASSISTANT);
        }
        String selected = Settings.Secure.getString(getContext().getContentResolver(), "assistant");
        android.content.ComponentName component = selected == null ? null : android.content.ComponentName.unflattenFromString(selected);
        return component != null && getContext().getPackageName().equals(component.getPackageName());
    }

    private JSObject view() {
        return new JSObject().put("enabled", preferences(getContext()).getBoolean("enabled", false))
            .put("assistant", isAssistant())
            .put("sideKey", Build.MANUFACTURER.equalsIgnoreCase("samsung") ? (sideKeyPending() ? "unset" : "set") : "none")
            .put("overlayPermission", Settings.canDrawOverlays(getContext()))
            .put("micPermission", microphoneGranted(getContext()))
            .put("holdTarget", "chat".equals(preferences(getContext()).getString("holdTarget", "jbot")) ? "chat" : "jbot")
            .put("holdToTalk", preferences(getContext()).getBoolean("holdToTalk", false))
            .put("slotNames", preferences(getContext()).getBoolean("slotNames", false))
            .put("sideKeyOnly", preferences(getContext()).getBoolean("sideKeyOnly", false))
            .put("sideKeyScreenshot", preferences(getContext()).getBoolean("sideKeyScreenshot", true))
            .put("sideKeyDictates", preferences(getContext()).getBoolean("sideKeyDictates", false))
            .put("sideKeyTarget", "chat".equals(preferences(getContext()).getString("sideKeyTarget", "jbot")) ? "chat" : "jbot")
            .put("screenContext", ConduitContext.screenReaderOn(getContext()));
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

    /** The side key's options: Float only on the side key, whether it screenshots, whether it dictates and to where. */
    @PluginMethod public void setSideKey(PluginCall call) {
        android.content.SharedPreferences.Editor edit = preferences(getContext()).edit();
        for (String key : new String[] { "sideKeyOnly", "sideKeyScreenshot", "sideKeyDictates" })
            if (call.hasOption(key)) edit.putBoolean(key, Boolean.TRUE.equals(call.getBoolean(key)));
        if (call.hasOption("sideKeyTarget")) edit.putString("sideKeyTarget", "chat".equals(call.getString("sideKeyTarget")) ? "chat" : "jbot");
        edit.apply();
        ConduitFloatService.optionsChanged();
        call.resolve(view());
    }

    @PluginMethod public void setSlotNames(PluginCall call) {
        android.content.SharedPreferences.Editor edit = preferences(getContext()).edit();
        if (call.hasOption("slotNames")) edit.putBoolean("slotNames", Boolean.TRUE.equals(call.getBoolean("slotNames")));
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
        String tokenOrigin = call.getString("tokenOrigin", origin);
        // Another server (not another path to the same one, which keeps its token origin): its lists start empty.
        if (!tokenOrigin.equals(preferences(getContext()).getString("tokenOrigin", tokenOrigin))) FloatPanel.forget();
        preferences(getContext()).edit().putString("origin", origin)
            .putString("tokenOrigin", tokenOrigin).apply();
    }

    // Follow hub/path changes without restarting a microphone service from a background WebView.
    @PluginMethod public void setOrigin(PluginCall call) {
        if ("".equals(call.getString("origin"))) {
            FloatPanel.forget();
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
        } catch (RuntimeException error) { call.reject("Could not start Float", error); return; }
        thenAssistant = true;
        screenContextStep(call);
    }

    /*
     * The assistant (optional): Android hands it the screen when it is called, but will not let it call itself, so it
     * is reached from a key. Make Conduit the digital assistant, then (Samsung) the side key's press and hold. Then,
     * when this is part of turning Float on, screen context.
     */
    private void assistantStep(PluginCall call) {
        permissionFlow = true;
        if (isAssistant()) { sideKeyStep(call); return; }
        ask("Make Conduit your assistant",
            "Optional: the side key can then open Float with the screen already taken, with its text. Choose Conduit "
                + "as the digital assistant app, allow Use screenshot and Use text on screen, then come back.",
            "Choose", () -> {
                try { startActivityForResult(call, new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS), "assistantReturned"); }
                catch (RuntimeException noVoiceSettings) {
                    try { startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS), "assistantReturned"); }
                    catch (RuntimeException none) { nextAfterAssistant(call); }
                }
            }, call, () -> nextAfterAssistant(call));
    }

    /** Turning Float on: screen context, then the assistant. From a Settings row, only that row's steps. */
    private boolean thenAssistant;

    @ActivityCallback private void assistantReturned(PluginCall call, ActivityResult result) {
        if (call == null) { permissionFlow = false; return; }
        if (isAssistant()) sideKeyStep(call); else nextAfterAssistant(call);
    }

    /**
     * Samsung keeps a long press on home for Circle to Search; its side key can call the assistant instead: press and
     * hold opens Float with the screen already taken. Its setting is hidden from apps, so the step shows until the
     * person has been through the page once.
     */
    private void sideKeyStep(PluginCall call) {
        if (!sideKeyPending()) { nextAfterAssistant(call); return; }
        ask("Side key opens Float",
            "Hold the side key on any screen to open Float with that screen already captured. In Press and hold, "
                + "choose Digital assistant, then come back.",
            "Open side key", () -> {
                try { startActivityForResult(call, new Intent("com.samsung.android.intent.action.SIDE_KEY_LONG_PRESS_SETTINGS"), "sideKeyReturned"); }
                catch (RuntimeException notSamsung) { nextAfterAssistant(call); }
            }, call, () -> nextAfterAssistant(call));
    }

    private boolean sideKeyPending() {
        return Build.MANUFACTURER.equalsIgnoreCase("samsung") && !preferences(getContext()).getBoolean("sideKeyHandled", false);
    }

    @ActivityCallback private void sideKeyReturned(PluginCall call, ActivityResult result) {
        preferences(getContext()).edit().putBoolean("sideKeyHandled", true).apply();
        if (call == null) { permissionFlow = false; return; }
        nextAfterAssistant(call);
    }

    /** Settings' Side key row: Samsung's Press and hold page. */
    @PluginMethod public void openSideKeySettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { startActivityForResult(call, new Intent("com.samsung.android.intent.action.SIDE_KEY_LONG_PRESS_SETTINGS"), "sideKeyReturned"); }
            catch (RuntimeException notSamsung) { call.resolve(view()); }
        });
    }

    private void nextAfterAssistant(PluginCall call) { permissionFlow = false; call.resolve(view()); }

    /** Screen context is done or skipped: on to the assistant when turning Float on, else the flow ends. */
    private void afterScreenContext(PluginCall call) {
        if (thenAssistant) { thenAssistant = false; assistantStep(call); return; }
        permissionFlow = false;
        call.resolve(view());
    }

    /** Settings' Assistant row: make Conduit the assistant, then the side key. */
    @PluginMethod public void setUpAssistant(PluginCall call) {
        getActivity().runOnUiThread(() -> { thenAssistant = false; assistantStep(call); });
    }

    /*
     * The rest of turning Float on, one step at a time, each introduced by a short dialog that says what to tap and
     * can be skipped: an app installed from an APK first needs App info > ⋮ > Allow restricted settings (Android 13+),
     * then Float screen context in Accessibility. Skipping leaves Float on, without instant screenshots.
     */
    private void screenContextStep(PluginCall call) {
        if (ConduitContext.screenReaderOn(getContext())) { afterScreenContext(call); return; }
        permissionFlow = true;
        if (restrictedSettingsBlocked()) {
            ask("Allow restricted settings",
                "Android holds back Accessibility for apps installed from a file. In App info, tap ⋮ at the top right, "
                    + "then Allow restricted settings, then come back.",
                "Open App info", () -> startActivityForResult(call, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName())), "restrictedReturned"), call,
                () -> afterScreenContext(call));
        } else accessibilityStep(call);
    }

    @ActivityCallback private void restrictedReturned(PluginCall call, ActivityResult result) {
        preferences(getContext()).edit().putBoolean("restrictedHandled", true).apply();
        if (call == null) { permissionFlow = false; return; }
        accessibilityStep(call);
    }

    private void accessibilityStep(PluginCall call) {
        ask("Turn on Float screen context",
            "Screenshots without asking each time, the text on screen with them, and Float's frosted panels. "
                + "In Installed apps, turn on Float screen context, then come back.",
            "Open settings", () -> {
                try { startActivityForResult(call, new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS), "accessibilityReturned"); }
                catch (RuntimeException unavailable) { afterScreenContext(call); }
            }, call, () -> afterScreenContext(call));
    }

    @ActivityCallback private void accessibilityReturned(PluginCall call, ActivityResult result) {
        if (call == null) { permissionFlow = false; return; }
        afterScreenContext(call);
    }

    /** A step's dialog: its button runs the step; Skip (or Back) goes on to what follows. */
    private void ask(String title, String message, String go, Runnable step, PluginCall call, Runnable skip) {
        new android.app.AlertDialog.Builder(getActivity()).setTitle(title).setMessage(message)
            .setPositiveButton(go, (dialog, which) -> step.run())
            .setNegativeButton("Skip", (dialog, which) -> skip.run())
            .setOnCancelListener(dialog -> skip.run())
            .show();
    }

    /**
     * Android 13+ restricts Accessibility for an app not installed from a store (a file, adb, Conduit's own updater:
     * Conduit is never in a store) until App info's Allow restricted settings. The op itself is hidden from apps, so
     * the step shows until the person has been through App info for it (remembered once they come back).
     */
    static boolean restrictedSettingsBlocked(Context context) {
        return Build.VERSION.SDK_INT >= 33 && !preferences(context).getBoolean("restrictedHandled", false);
    }

    private boolean restrictedSettingsBlocked() { return restrictedSettingsBlocked(getContext()); }

    /** The screen-context steps alone, for Settings' row when Float is already on. */
    @PluginMethod public void setUpScreenContext(PluginCall call) {
        getActivity().runOnUiThread(() -> { thenAssistant = false; screenContextStep(call); });
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

    /** Android's page for Float screen context (the Accessibility service behind instant screenshots and the frost). */
    @PluginMethod public void openScreenContextSettings(PluginCall call) {
        ConduitContext.openScreenReaderSettings(getContext());
        call.resolve(view());
    }

    @PluginMethod public void openOverlaySettings(PluginCall call) {
        getActivity().runOnUiThread(() -> startActivityForResult(call, overlayIntent(), "settingsReturned"));
    }

    @PluginMethod public void openAssistantSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS), "settingsReturned");
            } catch (android.content.ActivityNotFoundException noVoiceSettings) {
                startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS), "settingsReturned");
            }
        });
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
