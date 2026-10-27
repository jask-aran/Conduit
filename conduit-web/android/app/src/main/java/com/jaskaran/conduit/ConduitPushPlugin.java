package com.jaskaran.conduit;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;
import org.unifiedpush.android.connector.UnifiedPush;

@CapacitorPlugin(name = "ConduitPush", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class ConduitPushPlugin extends Plugin {
    static final String PREFS = "conduit.push";
    static final String INSTANCE = "conduit.push.instance";
    static final String PATH = "conduit.push.path";
    private static volatile ConduitPushPlugin loaded;

    @Override
    public void load() {
        loaded = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (loaded == this) loaded = null;
        super.handleOnDestroy();
    }

    static void emit(String event, JSObject data) {
        ConduitPushPlugin plugin = loaded;
        if (plugin != null) plugin.notifyListeners(event, data);
    }

    /**
     * A notification tap, from a cold start or while running. Kept until the page consumes it, so a tap that started
     * the app before the page could listen is not lost; `opened` only tells a running page to look.
     */
    public static void handleIntent(Activity activity, Intent intent) {
        if (intent == null || !intent.hasExtra(INSTANCE) || !intent.hasExtra(PATH)) return;
        String instance = intent.getStringExtra(INSTANCE);
        String path = intent.getStringExtra(PATH);
        intent.removeExtra(INSTANCE);
        intent.removeExtra(PATH);
        if (instance == null || path == null) return;
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(INSTANCE, instance).putString(PATH, path).apply();
        emit("opened", new JSObject().put("instance", instance).put("path", path));
    }

    private String permission() {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        PermissionState state = getPermissionState("notifications");
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSArray distributors = new JSArray();
        PackageManager pm = getContext().getPackageManager();
        for (String id : UnifiedPush.getDistributors(getContext())) {
            try {
                // This app is listed when its built-in distributor can reach Play services.
                String label = id.equals(getContext().getPackageName()) ? "Google Play services"
                    : pm.getApplicationLabel(pm.getApplicationInfo(id, 0)).toString();
                distributors.put(new JSObject().put("id", id).put("label", label));
            } catch (PackageManager.NameNotFoundException ignored) {}
        }
        String distributor = UnifiedPush.getAckDistributor(getContext());
        if (distributor == null) distributor = UnifiedPush.getSavedDistributor(getContext());
        call.resolve(new JSObject().put("distributors", distributors)
            .put("distributor", distributor == null ? JSONObject.NULL : distributor)
            .put("permission", permission()));
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            permissionResult(call);
        } else {
            requestPermissionForAlias("notifications", call, "permissionResult");
        }
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        call.resolve(new JSObject().put("permission", permission()));
    }

    @PluginMethod
    public void useDistributor(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("Distributor id is required");
            return;
        }
        UnifiedPush.saveDistributor(getContext(), id);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void register(PluginCall call) {
        String instance = call.getString("instance");
        String vapid = call.getString("vapid");
        String label = call.getString("label");
        if (instance == null || instance.isEmpty()) {
            call.reject("Instance is required");
            return;
        }
        if (vapid == null || !vapid.matches("[A-Za-z0-9_-]{87}")) {
            call.reject("Invalid VAPID key", "bad_vapid");
            return;
        }
        // Nothing chosen yet: Google's push service, built in, when Play services is there. Another distributor (ntfy) is
        // used only when picked.
        Context context = getContext();
        if (UnifiedPush.getAckDistributor(context) == null && UnifiedPush.getSavedDistributor(context) == null
            && UnifiedPush.getDistributors(context).contains(context.getPackageName())) {
            UnifiedPush.saveDistributor(context, context.getPackageName());
        }
        if (UnifiedPush.getAckDistributor(getContext()) != null || UnifiedPush.getSavedDistributor(getContext()) != null) {
            registerWithDistributor(call, instance, label, vapid);
        } else {
            UnifiedPush.tryUseCurrentOrDefaultDistributor(getActivity(), success -> {
                if (success) {
                    registerWithDistributor(call, instance, label, vapid);
                } else {
                    String code = UnifiedPush.getDistributors(getContext()).isEmpty() ? "no_distributor" : "choose_distributor";
                    call.reject("No distributor selected", code);
                }
                return kotlin.Unit.INSTANCE;
            });
        }
    }

    private void registerWithDistributor(PluginCall call, String instance, String label, String vapid) {
        try {
            UnifiedPush.register(getContext(), instance, label, vapid);
            call.resolve(new JSObject());
        } catch (Exception e) {
            if (e instanceof UnifiedPush.VapidNotValidException) {
                call.reject("Invalid VAPID key", "bad_vapid", e);
            } else {
                throw new RuntimeException(e);
            }
        }
    }

    @PluginMethod
    public void unregister(PluginCall call) {
        String instance = call.getString("instance");
        if (instance == null || instance.isEmpty()) {
            call.reject("Instance is required");
            return;
        }
        UnifiedPush.unregister(getContext(), instance);
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("endpoint." + instance).apply();
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void endpoints(PluginCall call) {
        JSArray endpoints = new JSArray();
        for (java.util.Map.Entry<String, ?> entry : getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getAll().entrySet()) {
            if (!entry.getKey().startsWith("endpoint.") || !(entry.getValue() instanceof String)) continue;
            try {
                endpoints.put(new JSObject((String) entry.getValue()));
            } catch (JSONException ignored) {}
        }
        call.resolve(new JSObject().put("endpoints", endpoints));
    }

    @PluginMethod
    public void consumeOpened(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String instance = prefs.getString(INSTANCE, null);
        String path = prefs.getString(PATH, null);
        prefs.edit().remove(INSTANCE).remove(PATH).apply();
        call.resolve(new JSObject().put("instance", instance == null ? JSONObject.NULL : instance)
            .put("path", path == null ? JSONObject.NULL : path));
    }
}
