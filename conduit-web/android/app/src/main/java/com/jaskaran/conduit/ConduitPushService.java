package com.jaskaran.conduit;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;
import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.data.PublicKeySet;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

import java.nio.charset.StandardCharsets;

public class ConduitPushService extends PushService {
    @Override
    public void onNewEndpoint(PushEndpoint endpoint, String instance) {
        PublicKeySet keys = endpoint.getPubKeySet();
        JSObject data = new JSObject().put("instance", instance).put("url", endpoint.getUrl())
            .put("pubKey", keys == null ? JSONObject.NULL : keys.getPubKey())
            .put("auth", keys == null ? JSONObject.NULL : keys.getAuth())
            .put("temporary", endpoint.getTemporary());
        getSharedPreferences(ConduitPushPlugin.PREFS, MODE_PRIVATE).edit()
            .putString("endpoint." + instance, data.toString()).apply();
        ConduitPushPlugin.emit("endpoint", data);
    }

    @Override
    public void onUnregistered(String instance) {
        getSharedPreferences(ConduitPushPlugin.PREFS, MODE_PRIVATE).edit().remove("endpoint." + instance).apply();
        ConduitPushPlugin.emit("unregistered", new JSObject().put("instance", instance));
    }

    @Override
    public void onRegistrationFailed(FailedReason reason, String instance) {
        ConduitPushPlugin.emit("failed", new JSObject().put("instance", instance).put("reason", reason.name()));
    }

    @Override
    public void onMessage(PushMessage message, String instance) {
        if (!message.getDecrypted()) return;
        try {
            JSONObject payload = new JSONObject(new String(message.getContent(), StandardCharsets.UTF_8));
            Object version = payload.opt("v");
            Object title = payload.opt("title");
            if (!(version instanceof Number) || ((Number) version).doubleValue() != 1 || !(title instanceof String)) return;
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                Log.d("ConduitPush", "Notification permission not granted");
                return;
            }
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(new NotificationChannel("agent", "Agent", NotificationManager.IMPORTANCE_DEFAULT));
                manager.createNotificationChannel(new NotificationChannel("agent_urgent", "Agent: urgent", NotificationManager.IMPORTANCE_HIGH));
            }
            String body = payload.opt("body") instanceof String ? payload.optString("body") : "";
            String hub = payload.opt("hub") instanceof String ? payload.optString("hub") : instance;
            String tag = payload.opt("tag") instanceof String ? payload.optString("tag") : "agent";
            String notificationTag = hub + ":" + tag;
            String path = payload.opt("path") instanceof String ? payload.optString("path") : "/";
            if (!path.startsWith("/") || path.startsWith("//")) path = "/";
            Intent intent = new Intent(this, MainActivity.class)
                .setData(new Uri.Builder().scheme("conduit-push").appendPath(notificationTag).build())
                .putExtra(ConduitPushPlugin.INSTANCE, instance).putExtra(ConduitPushPlugin.PATH, path);
            PendingIntent pending = PendingIntent.getActivity(this, notificationTag.hashCode(), intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            String channel = "high".equals(payload.optString("urgency")) ? "agent_urgent" : "agent";
            NotificationCompat.Builder notification = new NotificationCompat.Builder(this, channel)
                .setSmallIcon(R.drawable.ic_stat_conduit)
                // Conduit's black behind the mark; unset, Samsung fills it with the system accent (blue).
                .setColor(androidx.core.content.ContextCompat.getColor(this, R.color.conduit_frame)).setContentTitle((String) title).setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE).setContentIntent(pending);
            JSONObject answer = payload.optJSONObject("answer");
            if (answer != null && answer.optString("token").matches("[A-Za-z0-9_-]{43}")) {
                for (String choice : new String[] { "allow", "always", "deny" }) {
                    Intent action = new Intent(this, ConduitPushAnswerReceiver.class)
                        .setData(new Uri.Builder().scheme("conduit-answer").appendPath(notificationTag).appendPath(choice).build())
                        .putExtra("instance", instance).putExtra("token", answer.optString("token"))
                        .putExtra("choice", choice).putExtra("tag", notificationTag).putExtra("path", path)
                        .putExtra("channel", channel);
                    PendingIntent actionIntent = PendingIntent.getBroadcast(this, (notificationTag + choice).hashCode(), action,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    // Allowing needs the phone unlocked (Android 12+): from a locked phone, anyone holding it could tap it.
                    notification.addAction(new NotificationCompat.Action.Builder(0, answer.optString(choice, choice.equals("allow") ? "Allow" : choice.equals("always") ? "Always" : "Don't"), actionIntent)
                        .setAuthenticationRequired(!"deny".equals(choice)).build());
                }
            }
            manager.notify(notificationTag, 0, notification.build());
        } catch (JSONException e) {
            Log.d("ConduitPush", "Invalid notification payload", e);
        }
    }
}
