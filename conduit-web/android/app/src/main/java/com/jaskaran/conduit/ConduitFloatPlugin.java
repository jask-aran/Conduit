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
        openSettingsFrom(getActivity().getIntent());
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
                    // Back as soon as it is allowed (no card: Float may not draw yet).
                    guide().show(null, () -> Settings.canDrawOverlays(getContext()), this::returnToApp);
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
        guide().hide();
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
        step(call, "Choose " + appLabel() + ".",
            new Intent[] { new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS), new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS) },
            "assistantReturned", this::isAssistant, () -> nextAfterAssistant(call));
    }

    /** Turning Float on, or Settings' Set up: screen context, then the assistant. */
    private boolean thenAssistant;

    @ActivityCallback private void assistantReturned(PluginCall call, ActivityResult result) {
        guide().hide();
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
        step(call, "Under Press and hold, choose Digital assistant.",
            new Intent[] { new Intent("com.samsung.android.intent.action.SIDE_KEY_LONG_PRESS_SETTINGS") },
            "sideKeyReturned", null, () -> nextAfterAssistant(call));
    }

    private boolean sideKeyPending() {
        return Build.MANUFACTURER.equalsIgnoreCase("samsung") && !preferences(getContext()).getBoolean("sideKeyHandled", false);
    }

    @ActivityCallback private void sideKeyReturned(PluginCall call, ActivityResult result) {
        preferences(getContext()).edit().putBoolean("sideKeyHandled", true).apply();
        guide().hide();
        if (call == null) { permissionFlow = false; return; }
        nextAfterAssistant(call);
    }

    private void nextAfterAssistant(PluginCall call) { permissionFlow = false; call.resolve(view()); }

    /** Screen context is done or skipped: on to the assistant when turning Float on, else the flow ends. */
    private void afterScreenContext(PluginCall call) {
        if (thenAssistant) { thenAssistant = false; assistantStep(call); return; }
        permissionFlow = false;
        call.resolve(view());
    }

    /*
     * The rest of turning Float on, one step at a time, each introduced by a short dialog that says what to tap and
     * can be skipped: Float screen context in Accessibility, and, when that comes back still off on Android 13+, App
     * info > ⋮ > Allow restricted settings (an app installed from an APK is restricted until then; Samsung offers the
     * item only once the service has been tried), then Accessibility again. Whether the app is restricted is hidden
     * from it, and a flag kept for it lies after a reinstall (Android restores the app's preferences, not the
     * permission), so screen context being on is the only thing read. Skipping leaves Float on, without instant
     * screenshots.
     */
    private boolean triedRestricted;

    private void screenContextStep(PluginCall call) {
        if (ConduitContext.screenReaderOn(getContext())) { afterScreenContext(call); return; }
        permissionFlow = true;
        triedRestricted = false;
        accessibilityStep(call);
    }

    private void restrictedStep(PluginCall call) {
        triedRestricted = true;
        step(call, "Tap ⋮ at the top right, then Allow restricted settings.",
            new Intent[] { new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())) },
            "restrictedReturned", null, () -> afterScreenContext(call));
    }

    @ActivityCallback private void restrictedReturned(PluginCall call, ActivityResult result) {
        guide().hide();
        if (call == null) { permissionFlow = false; return; }
        accessibilityStep(call);
    }

    private void accessibilityStep(PluginCall call) {
        step(call, "Tap Installed apps, then Float screen context, and turn it on.",
            new Intent[] { new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS) },
            "accessibilityReturned", () -> ConduitContext.screenReaderOn(getContext()), () -> afterScreenContext(call));
    }

    @ActivityCallback private void accessibilityReturned(PluginCall call, ActivityResult result) {
        guide().hide();
        if (call == null) { permissionFlow = false; return; }
        // Still off: most likely restricted (its switch greyed, "Restricted setting"), so App info once, then back here.
        if (!ConduitContext.screenReaderOn(getContext()) && Build.VERSION.SDK_INT >= 33 && !triedRestricted) { restrictedStep(call); return; }
        afterScreenContext(call);
    }

    /*
     * A step's Settings page, opened at once (its first fallback that exists) with a toast saying what to tap there,
     * and Conduit back by itself once the step is done when Android can tell (done). Back from the page goes on to
     * the next step, as Skip did. Settings lets no app open its Accessibility entry, point at a row or draw over these
     * pages, so the toast is how the way there is shown.
     */
    private void step(PluginCall call, String line, Intent[] intents, String callback,
                      java.util.function.BooleanSupplier done, Runnable skip) {
        for (Intent intent : intents) {
            try { startActivityForResult(call, intent, callback); }
            catch (RuntimeException unavailable) { continue; }
            guide().show(line, done, this::returnToApp);
            return;
        }
        skip.run();
    }

    private FloatSetupGuide guide;

    private FloatSetupGuide guide() { if (guide == null) guide = new FloatSetupGuide(getContext()); return guide; }

    private void returnToApp() { FloatSetupGuide.returnToApp(getContext()); }

    private String appLabel() { return getContext().getApplicationInfo().loadLabel(getContext().getPackageManager()).toString(); }


    /** Settings' Set up: every step Float is still missing, in order, each skippable (Float is already on). */
    @PluginMethod public void setUp(PluginCall call) {
        getActivity().runOnUiThread(() -> { thenAssistant = true; screenContextStep(call); });
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

    /** On the intent that opens the app: show Settings › Phone (Float's notification to set up screen context). */
    static final String OPEN_SETTINGS = "conduit.float.settings";

    @Override protected void handleOnNewIntent(Intent intent) {
        pendingRecord |= intent != null && intent.getBooleanExtra("conduit.float.record", false);
        openSettingsFrom(intent);
    }


    /** The section the app was opened for, until the page takes it (a cold start opens before it is listening). */
    private static String settingsWanted;

    private void openSettingsFrom(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(OPEN_SETTINGS, false)) return;
        intent.removeExtra(OPEN_SETTINGS);
        settingsWanted = "device";
        notifyListeners("openSettings", new com.getcapacitor.JSObject());
    }

    @PluginMethod public void takeOpenSettings(PluginCall call) {
        String section = settingsWanted;
        settingsWanted = null;
        call.resolve(new com.getcapacitor.JSObject().put("section", section));
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
