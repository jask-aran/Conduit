package com.jaskaran.conduit;

import android.content.Context;
import android.os.Handler;
import java.io.File;
import java.io.FileInputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;

final class FloatSender {
    interface Listener {
        void onFailureText(String text);
        void onComplete(boolean sent);
    }
    private final Context context;
    private final ExecutorService worker;
    private final Handler main;
    private volatile HttpURLConnection uploading;

    FloatSender(Context context, ExecutorService worker, Handler main) {
        this.context = context;
        this.worker = worker;
        this.main = main;
    }

    void cancel() {
        HttpURLConnection connection = uploading;
        if (connection != null) new Thread(connection::disconnect, "float-cancel").start();
    }

    void send(File recording, String origin, String tokenOrigin, String recordingId,
              java.util.function.BooleanSupplier current, Listener listener) {
        worker.execute(() -> {
            boolean success = false;
            HttpURLConnection connection = null;
            try {
                if (!current.getAsBoolean()) return;
                connection = ConduitHubAuth.open(context, origin, tokenOrigin, "/v0/agent/voice-message", "POST");
                uploading = connection;
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(610_000);
                connection.setRequestProperty("Content-Type", "audio/wav");
                if (!recordingId.isEmpty()) connection.setRequestProperty("X-Conduit-Voice-Id", recordingId);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(recording.length());
                if (!current.getAsBoolean()) return;
                try (FileInputStream in = new FileInputStream(recording); java.io.OutputStream out = connection.getOutputStream()) {
                    byte[] buffer = new byte[16 * 1024];
                    int count;
                    while ((count = in.read(buffer)) != -1) {
                        if (!current.getAsBoolean()) return;
                        out.write(buffer, 0, count);
                    }
                }
                int status = connection.getResponseCode();
                success = status >= 200 && status < 300;
                if (!success) listener.onFailureText(failureText(status, connection));
            } catch (Exception error) {
                // The retry retains the private WAV. No cookie, token, audio, or response body enters a log.
                listener.onFailureText("Couldn't reach Conduit");
            } finally {
                if (connection != null) connection.disconnect();
                uploading = null;
            }
            boolean sent = success;
            main.post(() -> {
                if (!current.getAsBoolean()) return;
                listener.onComplete(sent);
            });
        });
    }

    /** The hub answers `{ error, message }`; the pill shows its message, a plain line per code when it has none. */
    private static String failureText(int status, HttpURLConnection connection) {
        if (status == 401 || status == 403) return "Sign in to Conduit again";
        String code = "", message = "";
        try (java.io.InputStream in = connection.getErrorStream()) {
            if (in != null) {
                byte[] body = in.readAllBytes();
                org.json.JSONObject json = new org.json.JSONObject(new String(body, java.nio.charset.StandardCharsets.UTF_8));
                code = json.optString("error", "");
                message = json.optString("message", "");
            }
        } catch (Exception ignored) {}
        if (!message.isEmpty()) return message.replaceAll("[\\r\\n]+", " ");
        switch (code) {
            case "voice_off": return "Voice is off in Conduit's settings";
            case "nothing_heard": return "Didn't catch anything";
            case "voice_unavailable": return "Voice isn't available on the hub";
            case "agent_off": return "jbot is off";
            case "agent_not_enabled": return "This hub has no jbot";
            default: return status >= 500 ? "Conduit hit an error — try again" : "Couldn't send — open Conduit";
        }
    }

}
