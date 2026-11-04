package com.jaskaran.conduit;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import java.io.File;
import java.io.FileInputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.function.BooleanSupplier;

final class FloatSender {
    interface Listener {
        void onFailureText(String text);
        void onComplete(boolean sent, String chatIdOrNull);
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
              BooleanSupplier current, Listener listener) {
        send(FloatTarget.jbot(), recording, null, Collections.emptyList(), recordingId,
            origin, tokenOrigin, current, listener);
    }

    /** Keep delivery IDs and the image order unchanged until success or discard. */
    void send(FloatTarget target, File wavOrNull, String textOrNull, List<File> images, String deliveryId,
              String origin, String tokenOrigin, BooleanSupplier current, Listener listener) {
        List<File> photos = images == null ? Collections.emptyList() : new ArrayList<>(images);
        worker.execute(() -> {
            boolean success = false;
            String chatId = null;
            try {
                if (!current.getAsBoolean()) return;
                if (target.kind == FloatTarget.Kind.JBOT && !photos.isEmpty()) {
                    listener.onFailureText("jbot can't take pictures yet — send them to a chat");
                } else if (target.kind == FloatTarget.Kind.JBOT && wavOrNull != null) {
                    success = sendVoice(wavOrNull, origin, tokenOrigin, deliveryId, current, listener);
                    if (!current.getAsBoolean()) return;
                } else {
                    if (deliveryId == null || deliveryId.isEmpty()) throw new IllegalArgumentException("Missing delivery ID");
                    SharedPreferences prefs = ConduitFloatPlugin.preferences(context);
                    String prefix = "delivery." + deliveryId + ".";
                    ConduitHubClient hub = new ConduitHubClient(context, origin, tokenOrigin);
                    chatId = target.kind == FloatTarget.Kind.CHAT ? target.chatId : prefs.getString(prefix + "chatId", null);
                    if (!prefs.getBoolean(prefix + "prompted", false)) {
                        String text = prefs.getString(prefix + "transcript", null);
                        if (text == null) {
                            if (textOrNull != null) text = textOrNull;
                            else if (wavOrNull != null) text = hub.transcribe(wavOrNull);
                            else text = "";
                            if (!saveCurrent(prefs.edit().putString(prefix + "transcript", text), current)) return;
                        }
                        if (!current.getAsBoolean()) return;
                        if (target.kind == FloatTarget.Kind.JBOT) {
                            if (!beginStep(prefs, prefix, "jbot message", current)) return;
                            try { hub.messageJbot(text); }
                            catch (ConduitHubClient.Failure error) { failedStep(prefs, prefix, error); throw error; }
                        } else {
                            // Creating a chat and uploading a photo may repeat after a lost reply: at worst an empty chat
                            // or an unused attachment is left. Only the message itself must never go twice.
                            if (chatId == null) {
                                if (!current.getAsBoolean()) return;
                                chatId = hub.createChat(target.projectId);
                                if (!saveCurrent(prefs.edit().putString(prefix + "chatId", chatId), current)) return;
                            }
                            List<String> attachmentIds = new ArrayList<>();
                            for (int i = 0; i < photos.size(); i++) {
                                if (!current.getAsBoolean()) return;
                                String key = prefix + "attachment." + i;
                                String id = prefs.getString(key, null);
                                if (id == null) {
                                    byte[] bytes;
                                    File file = photos.get(i);
                                    try (FileInputStream in = new FileInputStream(file)) { bytes = in.readAllBytes(); }
                                    // A capture's screen text travels as a text file beside its picture.
                                    boolean words = file.getName().endsWith(".txt");
                                    id = hub.uploadAttachment(chatId, bytes, words ? "text/plain" : "image/jpeg",
                                        (words ? "screen-" : "photo-") + (i + 1) + (words ? ".txt" : ".jpg"));
                                    if (!saveCurrent(prefs.edit().putString(key, id), current)) return;
                                }
                                attachmentIds.add(id);
                            }
                            if (!current.getAsBoolean()) return;
                            // promptChat forwards messageId; it does not guarantee deduplication across adapters.
                            // The read-only hub client generates its own ID. Never repeat an uncertain prompt.
                            if (!beginStep(prefs, prefix, "message send", current)) return;
                            try { hub.prompt(chatId, text, attachmentIds); }
                            catch (ConduitHubClient.Failure error) { failedStep(prefs, prefix, error); throw error; }
                        }
                        if (!saveCurrent(prefs.edit().putBoolean(prefix + "prompted", true).remove(prefix + "pending"), current)) return;
                    }
                    success = true;
                }
            } catch (ConduitHubClient.Failure error) {
                listener.onFailureText(error.message);
            } catch (IllegalStateException error) {
                listener.onFailureText(error.getMessage());
            } catch (Exception error) {
                listener.onFailureText("Couldn't reach Conduit");
            }
            boolean sent = success;
            String deliveredChatId = success && target.kind != FloatTarget.Kind.JBOT ? chatId : null;
            main.post(() -> {
                if (!current.getAsBoolean()) return;
                listener.onComplete(sent, deliveredChatId);
            });
        });
    }

    /** Remove delivery progress on success, cancel or discard; recording preferences are separate. */
    static synchronized void clearDelivery(Context context) {
        SharedPreferences prefs = ConduitFloatPlugin.preferences(context);
        SharedPreferences.Editor edit = prefs.edit();
        for (String key : prefs.getAll().keySet()) if (key.startsWith("delivery.")) edit.remove(key);
        save(edit);
    }

    private static void save(SharedPreferences.Editor edit) {
        if (!edit.commit()) throw new IllegalStateException("Couldn't save delivery progress — open Conduit before retrying");
    }

    private static synchronized boolean saveCurrent(SharedPreferences.Editor edit, BooleanSupplier current) {
        if (!current.getAsBoolean()) return false;
        save(edit);
        return true;
    }

    private static synchronized boolean beginStep(SharedPreferences prefs, String prefix, String step, BooleanSupplier current) {
        if (!current.getAsBoolean()) return false;
        String pending = prefs.getString(prefix + "pending", null);
        if (pending != null) throw new IllegalStateException(uncertainText(pending));
        // A process death or a lost reply cannot be distinguished from success by these hub methods.
        save(prefs.edit().putString(prefix + "pending", step));
        if (!current.getAsBoolean()) {
            save(prefs.edit().remove(prefix + "pending"));
            return false;
        }
        return true;
    }

    private static synchronized void failedStep(SharedPreferences prefs, String prefix, ConduitHubClient.Failure error) {
        String step = prefs.getString(prefix + "pending", null);
        if (step == null) return;
        // Only these route errors are known to occur before the corresponding write.
        boolean rejected = (step.equals("message send") && (error.code.equals("empty_prompt") || error.code.equals("subagent_read_only")))
            || (step.equals("jbot message") && error.code.equals("Say something"));
        if (rejected) save(prefs.edit().remove(prefix + "pending"));
        else throw new IllegalStateException(error.message + " " + uncertainText(step));
    }

    private static String uncertainText(String step) {
        return "Couldn't confirm " + step + " — check Conduit. Retry cannot resend this delivery.";
    }

    private boolean sendVoice(File recording, String origin, String tokenOrigin, String deliveryId,
                              BooleanSupplier current, Listener listener) {
        boolean success = false;
        HttpURLConnection connection = null;
        try {
            connection = ConduitHubAuth.open(context, origin, tokenOrigin, "/v0/agent/voice-message", "POST");
            uploading = connection;
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(610_000);
            connection.setRequestProperty("Content-Type", "audio/wav");
            if (!deliveryId.isEmpty()) connection.setRequestProperty("X-Conduit-Voice-Id", deliveryId);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(recording.length());
            if (!current.getAsBoolean()) return false;
            try (FileInputStream in = new FileInputStream(recording); java.io.OutputStream out = connection.getOutputStream()) {
                byte[] buffer = new byte[16 * 1024];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (!current.getAsBoolean()) return false;
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
        return success;
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
