package com.jaskaran.conduit;

import java.util.ArrayDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Float's live preview: the recording's PCM streamed to the hub's dictation socket (/v0/dictation/stream, as the
 * app's composer does), its partial and final text handed back. It opens only when the selected voice model
 * transcribes live (/v0/voice/settings). Optional throughout: any failure ends it quietly and leaves the WAV alone.
 * Protocol: wait for `ready`, send binary 16 kHz mono PCM16, then `{type:"stop", audioBytesSent}`.
 */
final class ConduitFloatLive {
    interface Token { String get() throws Exception; }
    interface Listener { void text(String text); }

    /** Audio held before `ready` (about 5 s), and the most OkHttp may have queued before frames are dropped. */
    private static final int PENDING_BYTES = 160_000, QUEUE_BYTES = 256 * 1024;
    private final String origin, cookie;
    private final Token tokenSource;
    private final Listener listener;
    private final ArrayDeque<byte[]> pending = new ArrayDeque<>();
    private int pendingBytes;
    private long audioBytes;
    private WebSocket socket;
    private boolean ready, stopping, stopSent, closed;

    ConduitFloatLive(String origin, String cookie, Token tokenSource, Listener listener) {
        this.origin = origin;
        this.cookie = cookie;
        this.tokenSource = tokenSource;
        this.listener = listener;
    }

    void start() { new Thread(this::open, "float-live").start(); }

    /** From the recording thread: never blocks; drops a frame when the socket is behind. */
    synchronized void audio(byte[] data, int length) {
        if (closed || stopping) return;
        byte[] frame = java.util.Arrays.copyOf(data, length);
        if (ready && socket != null) send(frame);
        else if (pendingBytes + length <= PENDING_BYTES) { pending.add(frame); pendingBytes += length; }
    }

    synchronized void stop() {
        stopping = true;
        sendStop();
    }

    synchronized void close() {
        closed = true;
        pending.clear();
        if (socket != null) socket.cancel();
    }

    private void send(byte[] frame) {
        if (socket.queueSize() > QUEUE_BYTES) return;
        if (socket.send(ByteString.of(frame))) audioBytes += frame.length;
    }

    private void sendStop() {
        if (!ready || stopSent || socket == null) return;
        stopSent = true;
        socket.send("{\"type\":\"stop\",\"audioBytesSent\":" + audioBytes + "}");
    }

    private Request.Builder request(String path, String token) {
        Request.Builder request = new Request.Builder().url(origin + path).header("Origin", "https://localhost");
        if (cookie != null && !cookie.isEmpty()) request.header("Cookie", cookie);
        if (token != null) request.header("Authorization", "Bearer " + token);
        return request;
    }

    private static JSONObject json(Response response) throws Exception {
        try (Response body = response) {
            if (body.code() != 200 || body.body() == null) throw new IllegalStateException();
            return new JSONObject(body.body().string());
        }
    }

    private static boolean streams(JSONObject settings) {
        String mode = settings.optString("mode");
        if ("remote".equals(mode)) return "openai_realtime_stream_v1".equals(settings.optString("adapter"));
        if (!"local".equals(mode)) return false;
        JSONObject local = settings.optJSONObject("local");
        JSONObject catalogue = local == null ? null : local.optJSONObject("catalogue");
        JSONArray profiles = catalogue == null ? null : catalogue.optJSONArray("profiles");
        String selected = settings.optString("resolvedProfileId");
        if (profiles == null || selected.isEmpty()) return false;
        for (int i = 0; i < profiles.length(); i++) {
            JSONObject profile = profiles.optJSONObject(i);
            if (profile != null && selected.equals(profile.optString("id"))) return "live".equals(profile.optString("execution"));
        }
        return false;
    }

    private void open() {
        try {
            String token = null;
            try { token = tokenSource.get(); } catch (Exception ignored) {}
            // The hub's paired-trust rule, as every Float request: the platform's trust, or a certificate its
            // attestation vouches for (whose name is then not checked against the address).
            AtomicBoolean vouched = new AtomicBoolean();
            javax.net.ssl.X509TrustManager trust = ConduitWebViewClient.pairedTrust(vouched);
            javax.net.ssl.SSLContext tls = javax.net.ssl.SSLContext.getInstance("TLS");
            tls.init(null, new javax.net.ssl.TrustManager[] { trust }, null);
            javax.net.ssl.HostnameVerifier names = javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier();
            OkHttpClient client = new OkHttpClient.Builder()
                .sslSocketFactory(tls.getSocketFactory(), trust)
                .hostnameVerifier((host, session) -> vouched.get() || names.verify(host, session))
                .followRedirects(false).followSslRedirects(false)
                .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
                .pingInterval(20, TimeUnit.SECONDS).build();
            if (isClosed() || !streams(json(client.newCall(request("/v0/voice/settings", token).build()).execute()))) return;
            String path = "/v0/dictation/stream";
            if (token != null) {
                String ticket = json(client.newCall(request("/v0/auth/socket-ticket", token)
                    .post(RequestBody.create(new byte[0], null)).build()).execute()).getString("ticket");
                path += "?ticket=" + java.net.URLEncoder.encode(ticket, "UTF-8");
            }
            synchronized (this) {
                if (closed) return;
                socket = client.newWebSocket(request(path, token).build(), new WebSocketListener() {
                    @Override public void onMessage(WebSocket webSocket, String text) {
                        try {
                            JSONObject event = new JSONObject(text);
                            String type = event.optString("type");
                            if ("ready".equals(type)) onReady();
                            else if ("partial".equals(type) || "final".equals(type)) listener.text(event.optString("text", ""));
                            else if ("completed".equals(type) || "error".equals(type)) webSocket.close(1000, null);
                        } catch (Exception ignored) {}
                    }
                    @Override public void onFailure(WebSocket webSocket, Throwable failure, Response response) { close(); }
                    @Override public void onClosing(WebSocket webSocket, int code, String reason) { webSocket.close(1000, null); }
                });
            }
        } catch (Exception ignored) {
            // No credentials, audio, server replies or transcript in logs.
            close();
        }
    }

    private synchronized boolean isClosed() { return closed; }

    private synchronized void onReady() {
        if (closed || ready) return;
        ready = true;
        while (!pending.isEmpty()) send(pending.poll());
        pendingBytes = 0;
        if (stopping) sendStop();
    }
}
