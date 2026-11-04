package com.jaskaran.conduit;

import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import org.json.JSONArray;
import org.json.JSONObject;

/** Optional live preview. All network errors leave the WAV recording alone. */
final class ConduitFloatLive {
    interface Token { String get() throws Exception; }
    interface Listener { void text(String text); }

    private static final int MAX_MESSAGE = 1024 * 1024;
    private final String origin, cookie;
    private final Token tokenSource;
    private final Listener listener;
    private final ConcurrentLinkedDeque<Frame> queue = new ConcurrentLinkedDeque<>();
    private final AtomicInteger queued = new AtomicInteger();
    private final SecureRandom random = new SecureRandom();
    private final AtomicInteger audioOffers = new AtomicInteger();
    private volatile Socket socket;
    private volatile boolean closed, stopping, ready;
    private long audioBytes;

    private static final class Frame {
        final int opcode;
        final byte[] data;
        final CountDownLatch sent = new CountDownLatch(1);
        Frame(int opcode, byte[] data) { this.opcode = opcode; this.data = data; }
    }

    ConduitFloatLive(String origin, String cookie, Token tokenSource, Listener listener) {
        this.origin = origin;
        this.cookie = cookie;
        this.tokenSource = tokenSource;
        this.listener = listener;
    }

    void start() { new Thread(this::run, "float-live").start(); }

    void audio(byte[] data, int length) {
        audioOffers.incrementAndGet();
        try {
            if (!closed && !stopping && queued.get() < 256)
                offer(new Frame(2, Arrays.copyOf(data, length)), false);
        } finally { audioOffers.decrementAndGet(); }
    }

    void stop() { stopping = true; }

    private boolean offer(Frame frame, boolean first) {
        int size;
        do {
            size = queued.get();
            if (size >= 256) return false;
        } while (!queued.compareAndSet(size, size + 1));
        if (first) queue.offerFirst(frame); else queue.offerLast(frame);
        return true;
    }

    private Frame poll(boolean first) {
        Frame frame = first ? queue.pollFirst() : queue.pollLast();
        if (frame != null) queued.decrementAndGet();
        return frame;
    }

    private void control(Frame frame) {
        if (!offer(frame, true)) { poll(false); offer(frame, true); }
    }

    void close() {
        closed = true;
        queue.clear();
        Socket current = socket;
        if (current != null) try { current.close(); } catch (Exception ignored) {}
    }

    private JSONObject request(String path, String method, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(origin + path).openConnection();
        try {
            if (connection instanceof HttpsURLConnection) ConduitWebViewClient.trustPaired((HttpsURLConnection) connection);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Origin", "https://localhost");
            if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (connection.getResponseCode() != 200) throw new IllegalStateException();
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (body.size() + count > MAX_MESSAGE) throw new IllegalStateException();
                    body.write(buffer, 0, count);
                }
                return new JSONObject(body.toString("UTF-8"));
            }
        } finally { connection.disconnect(); }
    }

    private boolean streams(JSONObject settings) {
        String mode = settings.optString("mode");
        if ("remote".equals(mode)) return "openai_realtime_stream_v1".equals(settings.optString("adapter"));
        if (!"local".equals(mode)) return false;
        JSONObject local = settings.optJSONObject("local");
        JSONObject catalog = local == null ? null : local.optJSONObject("catalogue");
        JSONArray profiles = catalog == null ? null : catalog.optJSONArray("profiles");
        String selected = settings.optString("resolvedProfileId");
        if (profiles == null || selected.isEmpty()) return false;
        for (int i = 0; i < profiles.length(); i++) {
            JSONObject profile = profiles.optJSONObject(i);
            if (profile != null && selected.equals(profile.optString("id")))
                return "live".equals(profile.optString("execution"));
        }
        return false;
    }

    private void run() {
        try {
            String token = null;
            try { token = tokenSource.get(); } catch (Exception ignored) {}
            if (closed || !streams(request("/v0/voice/settings", "GET", token)) || closed) return;
            String path = "/v0/dictation/stream";
            if (token != null) {
                String ticket = request("/v0/auth/socket-ticket", "POST", token).getString("ticket");
                path += "?ticket=" + URLEncoder.encode(ticket, "UTF-8");
            }
            if (closed) return;
            URL url = new URL(origin);
            if (url.getUserInfo() != null || !("https".equals(url.getProtocol()) || "http".equals(url.getProtocol()))) return;
            int port = url.getPort() == -1 ? url.getDefaultPort() : url.getPort();
            Socket raw = new Socket();
            socket = raw;
            if (closed) return;
            raw.connect(new InetSocketAddress(url.getHost(), port), 10_000);
            raw.setSoTimeout(10_000);
            if ("https".equals(url.getProtocol())) {
                AtomicBoolean vouched = new AtomicBoolean();
                SSLSocket tls = (SSLSocket) ConduitWebViewClient.pairedSocketFactory(vouched)
                    .createSocket(raw, url.getHost(), port, true);
                socket = tls;
                SSLParameters parameters = tls.getSSLParameters();
                try { parameters.setServerNames(Collections.singletonList(new SNIHostName(url.getHost()))); }
                catch (IllegalArgumentException ignored) { /* IP addresses have no SNI host name. */ }
                tls.setSSLParameters(parameters);
                tls.startHandshake();
                if (!vouched.get() && !HttpsURLConnection.getDefaultHostnameVerifier().verify(url.getHost(), tls.getSession()))
                    throw new IllegalStateException();
            }
            if (closed) return;
            Socket connected = socket;
            InputStream in = connected.getInputStream();
            OutputStream out = connected.getOutputStream();
            byte[] nonce = new byte[16];
            random.nextBytes(nonce);
            String key = Base64.encodeToString(nonce, Base64.NO_WRAP);
            String host = url.getHost().contains(":") ? "[" + url.getHost().replace("[", "").replace("]", "") + "]" : url.getHost();
            if (url.getPort() != -1) host += ":" + port;
            StringBuilder headers = new StringBuilder("GET ").append(path).append(" HTTP/1.1\r\nHost: ").append(host)
                .append("\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ")
                .append(key).append("\r\nOrigin: https://localhost\r\n");
            if (cookie != null && !cookie.isEmpty()) headers.append("Cookie: ").append(cookie).append("\r\n");
            if (token != null) headers.append("Authorization: Bearer ").append(token).append("\r\n");
            headers.append("\r\n");
            out.write(headers.toString().getBytes(StandardCharsets.US_ASCII));
            out.flush();
            String response = readHeaders(in);
            String[] lines = response.split("\r\n");
            if (lines.length == 0 || !lines[0].matches("HTTP/1\\.[01] 101(?: .*)?")) throw new IllegalStateException();
            String expected = Base64.encodeToString(MessageDigest.getInstance("SHA-1")
                .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)), Base64.NO_WRAP);
            boolean accepted = false, upgraded = false, connectionUpgrade = false;
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon < 0) continue;
                String name = lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = lines[i].substring(colon + 1).trim();
                if (name.equals("sec-websocket-accept")) accepted = expected.equals(value);
                if (name.equals("upgrade")) upgraded = value.equalsIgnoreCase("websocket");
                if (name.equals("connection")) for (String part : value.split(",")) if (part.trim().equalsIgnoreCase("upgrade")) connectionUpgrade = true;
            }
            if (!accepted || !upgraded || !connectionUpgrade) throw new IllegalStateException();
            connected.setSoTimeout(0);
            new Thread(() -> writeLoop(out, connected), "float-live-writer").start();
            readLoop(in);
        } catch (Exception ignored) {
            // No credentials, audio, server responses, or transcript in logs.
        } finally { close(); }
    }

    private String readHeaders(InputStream in) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int matched = 0;
        byte[] end = { 13, 10, 13, 10 };
        while (bytes.size() < 16_384) {
            int b = in.read();
            if (b < 0) throw new EOFException();
            bytes.write(b);
            matched = b == end[matched] ? matched + 1 : (b == end[0] ? 1 : 0);
            if (matched == 4) return bytes.toString("US-ASCII");
        }
        throw new IllegalStateException();
    }

    private void writeLoop(OutputStream out, Socket connected) {
        try {
            long deadline = System.currentTimeMillis() + 15_000;
            boolean stopSent = false;
            while (!closed) {
                if (!ready && System.currentTimeMillis() >= deadline) { close(); return; }
                Frame first = queue.peekFirst();
                if (!ready && (first == null || first.opcode < 8)) { Thread.sleep(10); continue; }
                Frame frame = poll(true);
                if (frame != null) {
                    writeFrame(out, frame.opcode, frame.data);
                    if (frame.opcode == 2) audioBytes += frame.data.length;
                    frame.sent.countDown();
                    if (frame.opcode == 8) return;
                } else if (ready && stopping && !stopSent && audioOffers.get() == 0 && queue.isEmpty()) {
                    byte[] stop = ("{\"type\":\"stop\",\"audioBytesSent\":" + audioBytes + "}").getBytes(StandardCharsets.UTF_8);
                    writeFrame(out, 1, stop);
                    stopSent = true;
                    connected.setSoTimeout(60_000);
                } else Thread.sleep(10);
            }
        } catch (Exception ignored) { close(); }
    }

    private void writeFrame(OutputStream out, int opcode, byte[] payload) throws Exception {
        out.write(0x80 | opcode);
        int length = payload.length;
        if (length < 126) out.write(0x80 | length);
        else if (length <= 65535) {
            out.write(0x80 | 126); out.write(length >>> 8); out.write(length);
        } else {
            out.write(0x80 | 127);
            for (int shift = 56; shift >= 0; shift -= 8) out.write((int) ((long) length >>> shift));
        }
        byte[] mask = new byte[4];
        random.nextBytes(mask);
        out.write(mask);
        byte[] masked = new byte[length];
        for (int i = 0; i < length; i++) masked[i] = (byte) (payload[i] ^ mask[i % 4]);
        out.write(masked);
        out.flush();
    }

    private int readByte(InputStream in) throws Exception {
        int value = in.read();
        if (value < 0) throw new EOFException();
        return value;
    }

    private void readLoop(InputStream in) throws Exception {
        ByteArrayOutputStream message = null;
        while (!closed) {
            int first = readByte(in), second = readByte(in);
            boolean fin = (first & 128) != 0;
            int opcode = first & 15;
            if ((first & 0x70) != 0 || (second & 128) != 0) throw new IllegalStateException();
            long length = second & 127;
            if (length == 126) length = ((long) readByte(in) << 8) | readByte(in);
            else if (length == 127) {
                length = 0;
                for (int i = 0; i < 8; i++) {
                    int b = readByte(in);
                    if (i == 0 && (b & 128) != 0) throw new IllegalStateException();
                    if (length > MAX_MESSAGE) throw new IllegalStateException();
                    length = (length << 8) | b;
                }
            }
            if (length > MAX_MESSAGE || (opcode >= 8 && (!fin || length > 125))) throw new IllegalStateException();
            byte[] payload = new byte[(int) length];
            for (int offset = 0; offset < payload.length;) {
                int count = in.read(payload, offset, payload.length - offset);
                if (count < 0) throw new EOFException();
                offset += count;
            }
            if (opcode == 8) {
                Frame reply = new Frame(8, payload);
                control(reply);
                reply.sent.await(500, TimeUnit.MILLISECONDS);
                return;
            }
            if (opcode == 9) {
                Frame pong = new Frame(10, payload);
                control(pong);
                continue;
            }
            if (opcode == 10) continue;
            if (opcode == 1 && message == null) message = new ByteArrayOutputStream();
            else if (opcode != 0 || message == null) throw new IllegalStateException();
            if (message.size() + payload.length > MAX_MESSAGE) throw new IllegalStateException();
            message.write(payload);
            if (fin) {
                JSONObject event = new JSONObject(message.toString("UTF-8"));
                message = null;
                String type = event.optString("type");
                if ("ready".equals(type)) ready = true;
                else if ("partial".equals(type) || "final".equals(type)) listener.text(event.optString("text", ""));
                else if ("completed".equals(type) || "error".equals(type)) return;
            }
        }
    }
}
