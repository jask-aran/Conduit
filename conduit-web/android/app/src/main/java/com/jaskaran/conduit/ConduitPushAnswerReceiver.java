package com.jaskaran.conduit;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.app.NotificationCompat;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class ConduitPushAnswerReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult result = goAsync();
        new Thread(() -> {
            String instance = intent.getStringExtra("instance");
            String token = intent.getStringExtra("token");
            String choice = intent.getStringExtra("choice");
            String tag = intent.getStringExtra("tag");
            String path = intent.getStringExtra("path");
            String channel = intent.getStringExtra("channel");
            boolean success = false;
            HttpURLConnection connection = null;
            try {
                String origin = context.getSharedPreferences(ConduitPushPlugin.PREFS, Context.MODE_PRIVATE)
                    .getString("origin." + instance, null);
                if (origin == null || token == null || !token.matches("[A-Za-z0-9_-]{43}")
                    || !("allow".equals(choice) || "always".equals(choice) || "deny".equals(choice))) throw new IllegalStateException();
                connection = (HttpURLConnection) new URL(origin + "/v0/push/answer/" + token).openConnection();
                if (connection instanceof javax.net.ssl.HttpsURLConnection)
                    ConduitWebViewClient.trustPaired((javax.net.ssl.HttpsURLConnection) connection);
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(10_000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                try (java.io.OutputStream out = connection.getOutputStream()) {
                    out.write(("{\"choice\":\"" + choice + "\"}").getBytes(StandardCharsets.UTF_8));
                }
                success = connection.getResponseCode() == 204;
            } catch (Exception ignored) {
                // The notification still opens the thread when the answer cannot be sent.
            } finally {
                if (connection != null) connection.disconnect();
                if (tag != null && instance != null && path != null && channel != null) {
                    Intent open = new Intent(context, MainActivity.class)
                        .setData(new Uri.Builder().scheme("conduit-push").appendPath(tag).build())
                        .putExtra(ConduitPushPlugin.INSTANCE, instance).putExtra(ConduitPushPlugin.PATH, path);
                    PendingIntent pending = PendingIntent.getActivity(context, tag.hashCode(), open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    String text = success ? ("allow".equals(choice) ? "Allowed" : "always".equals(choice) ? "Always allowed" : "Not allowed") : "Couldn't answer — open Conduit";
                    NotificationCompat.Builder notification = new NotificationCompat.Builder(context, channel)
                        .setSmallIcon(R.drawable.ic_stat_conduit)
                        .setColor(androidx.core.content.ContextCompat.getColor(context, R.color.conduit_frame))
                        .setContentTitle("Conduit").setContentText(text).setAutoCancel(true).setContentIntent(pending);
                    ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(tag, 0, notification.build());
                }
                result.finish();
            }
        }).start();
    }
}
