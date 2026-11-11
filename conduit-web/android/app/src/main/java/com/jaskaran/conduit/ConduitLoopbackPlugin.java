package com.jaskaran.conduit;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/** Loopback only; the URL carries an authorization code, so it is never logged. */
@CapacitorPlugin(name = "ConduitLoopback")
public class ConduitLoopbackPlugin extends Plugin {
    private static final int DEADLINE_MS = 10 * 60 * 1000;
    private static final String PAGE = "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\">"
        + "<title>Conduit</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;"
        + "font:16px system-ui,sans-serif\"><p>Signed in. Go back to Conduit.</p>";

    private ServerSocket server;
    private PluginCall pending;

    @PluginMethod
    public void listen(PluginCall call) {
        int port = call.getInt("port", 0);
        stopCurrent();
        ServerSocket socket;
        try {
            socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(InetAddress.getLoopbackAddress(), port));
        } catch (Exception e) {
            finish(call, null);
            return;
        }
        synchronized (this) { server = socket; pending = call; }
        new Thread(() -> serve(socket, call, port), "conduit-loopback").start();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopCurrent();
        call.resolve();
    }

    private void serve(ServerSocket socket, PluginCall call, int port) {
        String url = null;
        long deadline = System.currentTimeMillis() + DEADLINE_MS;
        try {
            while (url == null) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) break;
                socket.setSoTimeout((int) left);
                try (Socket client = socket.accept()) {
                    client.setSoTimeout(10000);
                    BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
                    String line = in.readLine();
                    String[] parts = line == null ? new String[0] : line.split(" ");
                    String target = parts.length >= 2 ? parts[1] : "";
                    OutputStream out = client.getOutputStream();
                    if (!target.startsWith("/") || target.indexOf('?') < 0) {
                        out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                        out.flush();
                        continue;
                    }
                    byte[] body = PAGE.getBytes(StandardCharsets.UTF_8);
                    out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + body.length
                        + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    out.write(body);
                    out.flush();
                    url = "http://localhost:" + port + target;
                } catch (java.net.SocketTimeoutException timeout) {
                    break;
                } catch (java.io.IOException perClient) {
                    if (socket.isClosed()) break;
                }
            }
        } catch (Exception ignored) {}
        try { socket.close(); } catch (Exception ignored) {}
        synchronized (this) {
            if (server == socket) server = null;
            if (pending != call) return; // stopped or replaced: already resolved with null
            pending = null;
        }
        finish(call, url);
        if (url != null) bringToFront();
    }

    private void stopCurrent() {
        ServerSocket socket;
        PluginCall call;
        synchronized (this) { socket = server; call = pending; server = null; pending = null; }
        if (socket != null) try { socket.close(); } catch (Exception ignored) {}
        if (call != null) finish(call, null);
    }

    private static void finish(PluginCall call, String url) {
        JSObject result = new JSObject();
        result.put("url", url == null ? JSObject.NULL : url);
        call.resolve(result);
    }

    private void bringToFront() {
        try {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
            if (intent == null) return;
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {}
    }
}
