package com.jaskaran.conduit;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Blocking hub requests. Call from a worker thread, never the main thread. */
public final class ConduitHubClient {
    private final Context context;
    private final String origin;
    private final String tokenOrigin;

    public ConduitHubClient(Context context, String origin, String tokenOrigin) {
        this.context = context.getApplicationContext();
        this.origin = origin;
        this.tokenOrigin = tokenOrigin;
    }

    public static final class Failure extends Exception {
        public final int status;
        public final String code;
        public final String message;

        private Failure(int status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
            this.message = message;
        }
    }

    public static final class Reply {
        public final String text;
        public final String at;

        private Reply(JSONObject value) throws Exception {
            text = value.getString("text");
            at = nullable(value, "at");
        }
    }

    public static final class RecentChat {
        public final String chatId;
        public final String title;
        public final String projectId;
        public final String projectName;
        public final String lastMessageAt;
        public final String liveStatus;
        public final Reply latestReply;

        private RecentChat(JSONObject value) throws Exception {
            chatId = value.getString("chatId");
            title = value.getString("title");
            projectId = value.getString("projectId");
            projectName = value.getString("projectName");
            lastMessageAt = nullable(value, "lastMessageAt");
            liveStatus = nullable(value, "liveStatus");
            latestReply = value.isNull("latestReply") ? null : new Reply(value.getJSONObject("latestReply"));
        }
    }

    public static final class Place {
        public final String id;
        public final String name;
        public final boolean isChat;
        /** A Workspace (a folder in Work, on this machine or a device), as opposed to a project in Chat. */
        public final boolean isWorkspace;
        /** The device it lives on when that is not the hub's own machine; null on the hub. */
        public final String deviceName;
        public final String appearanceMode;
        public final String appearanceValue;
        public final String appearanceColour;

        private Place(JSONObject value) throws Exception {
            id = value.getString("id");
            name = value.getString("name");
            isChat = "chat".equals(value.optString("slug"));
            // As the app's isWorkspace (place-picker.tsx): its kind, or a folder linked, created or cloned in.
            String origin = value.optString("origin", "");
            isWorkspace = "workspace".equals(value.optString("kind"))
                || "linked".equals(origin) || "created".equals(origin) || "cloned".equals(origin);
            JSONObject device = value.optJSONObject("capabilities") == null ? null
                : value.getJSONObject("capabilities").optJSONObject("device");
            deviceName = device == null || device.optBoolean("local", true) || device.optString("name", "").isEmpty()
                ? null : device.getString("name");
            JSONObject appearance = isWorkspace ? value.optJSONObject("workspaceAppearance") : null;
            String marker = appearance == null ? "" : appearance.optString("value", "");
            String monogram = FloatGlyphs.trim(marker);
            boolean hasMonogram = appearance != null && "monogram".equals(appearance.optString("mode"))
                && !monogram.isEmpty();
            appearanceMode = !isWorkspace ? null : hasMonogram ? "monogram" : "icon";
            appearanceValue = !isWorkspace ? null : hasMonogram
                ? monogram.substring(0, monogram.offsetByCodePoints(0, Math.min(2, monogram.codePointCount(0, monogram.length()))))
                : FloatGlyphs.iconId(marker);
            appearanceColour = !isWorkspace ? null : FloatGlyphs.colourId(appearance == null ? null : appearance.optString("color", ""));
        }
    }

    public String createChat(String projectIdOrNull) throws Failure {
        try {
            JSONObject body = new JSONObject();
            if (projectIdOrNull != null) body.put("projectId", projectIdOrNull);
            return json("/v0/chats", body).getString("id");
        } catch (Failure error) { throw error; }
        catch (Exception error) { throw invalidResponse(); }
    }

    public String uploadAttachment(String chatId, byte[] bytes, String mimeType, String name) throws Failure {
        String id = UUID.randomUUID().toString();
        request("/v0/chats/" + encode(chatId) + "/attachments/" + id + "?name=" + encode(name),
            "PUT", mimeType, bytes, null, 60_000);
        return id;
    }

    public void prompt(String chatId, String text, List<String> attachmentIds) throws Failure {
        try {
            JSONObject body = new JSONObject().put("message", text)
                .put("attachmentIds", new JSONArray(attachmentIds == null ? Collections.emptyList() : attachmentIds))
                .put("messageId", UUID.randomUUID().toString());
            json("/v0/chats/" + encode(chatId) + "/prompt", body);
        } catch (Failure error) { throw error; }
        catch (Exception error) { throw invalidResponse(); }
    }

    public void messageJbot(String text) throws Failure {
        try { json("/v0/agent/messages", new JSONObject().put("text", text)); }
        catch (Failure error) { throw error; }
        catch (Exception error) { throw invalidResponse(); }
    }

    public String transcribe(File wav) throws Failure {
        try {
            return request("/v0/voice/transcribe", "POST", "audio/wav", null, wav, 610_000).getString("text");
        } catch (Failure error) { throw error; }
        catch (Exception error) { throw invalidResponse(); }
    }

    public List<RecentChat> recentChats(int limit) throws Failure {
        try {
            JSONArray values = request("/v0/chats/recent?limit=" + limit, "GET", null, null, null, 60_000).getJSONArray("chats");
            List<RecentChat> chats = new ArrayList<>();
            for (int i = 0; i < values.length(); i++) chats.add(new RecentChat(values.getJSONObject(i)));
            return Collections.unmodifiableList(chats);
        } catch (Failure error) { throw error; }
        catch (Exception error) { throw invalidResponse(); }
    }

    public List<Place> places() throws Failure {
        try {
            JSONArray values = request("/v0/projects", "GET", null, null, null, 60_000).getJSONArray("projects");
            List<Place> places = new ArrayList<>();
            for (int i = 0; i < values.length(); i++) places.add(new Place(values.getJSONObject(i)));
            return Collections.unmodifiableList(places);
        } catch (Failure error) { throw error; }
        catch (Exception error) { throw invalidResponse(); }
    }

    private JSONObject json(String path, JSONObject body) throws Failure {
        return request(path, "POST", "application/json", body.toString().getBytes(StandardCharsets.UTF_8), null, 60_000);
    }

    private JSONObject request(String path, String method, String mimeType, byte[] bytes, File file, int readTimeout) throws Failure {
        HttpURLConnection connection = null;
        int status = 0;
        try {
            connection = ConduitHubAuth.open(context, origin, tokenOrigin, path, method);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(readTimeout);
            connection.setRequestProperty("Accept", "application/json");
            if (mimeType != null) connection.setRequestProperty("Content-Type", mimeType);
            if (bytes != null || file != null) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(file != null ? file.length() : (long) bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    if (file == null) output.write(bytes);
                    else try (InputStream input = new FileInputStream(file)) { copy(input, output); }
                }
            }
            status = connection.getResponseCode();
            boolean success = status >= 200 && status < 300;
            String body = "";
            try (InputStream input = success ? connection.getInputStream() : connection.getErrorStream()) {
                if (input != null) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    copy(input, output);
                    body = new String(output.toByteArray(), StandardCharsets.UTF_8);
                }
            }
            if (!success) {
                String code = "http_error";
                String message = "Hub request failed (HTTP " + status + ").";
                try {
                    JSONObject error = new JSONObject(body);
                    code = error.optString("error", error.optString("code", code));
                    message = error.optString("message", message);
                } catch (Exception ignored) { /* Non-JSON errors use the plain status line. */ }
                throw new Failure(status, code, message.replaceAll("[\\r\\n]+", " ").trim());
            }
            return body.trim().isEmpty() ? new JSONObject() : new JSONObject(body);
        } catch (Failure error) { throw error; }
        catch (org.json.JSONException error) { throw invalidResponse(); }
        catch (Exception error) {
            android.util.Log.w("ConduitHub", "request to " + origin + " failed", error);
            throw new Failure(status, "connection_failed", "Cannot reach the hub. Check the connection and sign in to Conduit.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String nullable(JSONObject value, String key) throws Exception {
        return value.isNull(key) ? null : value.getString(key);
    }

    private static String encode(String value) throws Failure {
        try { return URLEncoder.encode(value, "UTF-8").replace("+", "%20"); }
        catch (Exception error) { throw new Failure(0, "invalid_request", "The request has an invalid name or chat ID."); }
    }

    private static void copy(InputStream input, OutputStream output) throws java.io.IOException {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
    }

    private static Failure invalidResponse() {
        return new Failure(0, "invalid_response", "The hub returned an invalid response. Try again.");
    }
}
