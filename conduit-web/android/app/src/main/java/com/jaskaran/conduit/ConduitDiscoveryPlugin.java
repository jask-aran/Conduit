package com.jaskaran.conduit;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Hands back what `_conduit._tcp` advertised without judging it: whether an address is usable and proving the
 * identity belong to the web half. Each browse is bounded because `NsdManager` holds the multicast socket while it runs.
 */
@CapacitorPlugin(name = "ConduitDiscovery")
public class ConduitDiscoveryPlugin extends Plugin {

    private static final String SERVICE_TYPE = "_conduit._tcp.";
    private static final long MIN_TIMEOUT_MS = 500;
    private static final long MAX_TIMEOUT_MS = 10_000;

    private Browse browse;

    // Left to its timeout, a browse would hold the multicast socket for up to ten seconds after its window has gone.
    @Override
    protected void handleOnDestroy() {
        if (browse != null) browse.abandon();
        browse = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void resolve(PluginCall call) {
        String host = call.getString("host", "");
        new Thread(() -> {
            JSArray addresses = new JSArray();
            try {
                for (InetAddress address : InetAddress.getAllByName(host)) addresses.put(address.getHostAddress());
            } catch (Exception ignored) {
                // Not found is no addresses: the name is judged by itself.
            }
            JSObject result = new JSObject();
            result.put("addresses", addresses);
            call.resolve(result);
        }).start();
    }

    @PluginMethod
    public void discover(PluginCall call) {
        long timeout = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, call.getInt("timeoutMs", 3000).longValue()));
        NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) {
            // No responder on this device: nothing found, a state the page already draws.
            call.resolve(empty());
            return;
        }
        browse = new Browse(nsd, call);
        browse.run(timeout);
    }

    private static JSObject empty() {
        JSObject result = new JSObject();
        result.put("servers", new JSArray());
        return result;
    }

    /** Resolution is serialised: older `resolveService` fails a second concurrent one with FAILURE_ALREADY_ACTIVE. */
    private final class Browse {
        private final NsdManager nsd;
        private final PluginCall call;
        private final ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
        private final AtomicBoolean settled = new AtomicBoolean(false);
        private final Map<String, JSObject> found = Collections.synchronizedMap(new LinkedHashMap<>());
        private final ArrayDeque<NsdServiceInfo> waiting = new ArrayDeque<>();
        private boolean resolving = false;
        private NsdManager.DiscoveryListener discovery;

        Browse(NsdManager nsd, PluginCall call) {
            this.nsd = nsd;
            this.call = call;
        }

        void run(long timeoutMs) {
            discovery = new NsdManager.DiscoveryListener() {
                @Override public void onDiscoveryStarted(String type) {}
                @Override public void onDiscoveryStopped(String type) {}
                @Override public void onStartDiscoveryFailed(String type, int code) { finish(); }
                @Override public void onStopDiscoveryFailed(String type, int code) {}
                @Override public void onServiceFound(NsdServiceInfo service) { enqueue(service); }
                @Override public void onServiceLost(NsdServiceInfo service) {}
            };
            try {
                nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery);
            } catch (Exception error) {
                finish();
                return;
            }
            clock.schedule(this::finish, timeoutMs, TimeUnit.MILLISECONDS);
        }

        private synchronized void enqueue(NsdServiceInfo service) {
            waiting.add(service);
            pump();
        }

        private synchronized void pump() {
            if (resolving || waiting.isEmpty() || settled.get()) return;
            resolving = true;
            NsdServiceInfo next = waiting.poll();
            try {
                nsd.resolveService(next, new NsdManager.ResolveListener() {
                    @Override public void onResolveFailed(NsdServiceInfo service, int code) { released(); }
                    @Override public void onServiceResolved(NsdServiceInfo service) {
                        record(service);
                        released();
                    }
                });
            } catch (Exception error) {
                released();
            }
        }

        private synchronized void released() {
            resolving = false;
            pump();
        }

        private void record(NsdServiceInfo service) {
            List<String> addresses = new ArrayList<>();
            InetAddress host = service.getHost();
            // Every address: which one is reachable is the web half's rule.
            if (host != null) addresses.add(host.getHostAddress());
            for (InetAddress extra : hostAddresses(service)) {
                String text = extra.getHostAddress();
                if (text != null && !addresses.contains(text)) addresses.add(text);
            }
            if (addresses.isEmpty()) return;
            JSArray list = new JSArray();
            for (String address : addresses) list.put(address);
            JSObject entry = new JSObject();
            entry.put("name", service.getServiceName());
            entry.put("port", service.getPort());
            entry.put("addresses", list);
            entry.put("id", text(service, "id"));
            entry.put("publicKey", text(service, "key"));
            found.put(service.getServiceName() + ":" + service.getPort(), entry);
            // So a list need not wait out the whole browse; the call still resolves with everything.
            notifyListeners("found", entry);
        }

        private List<InetAddress> hostAddresses(NsdServiceInfo service) {
            // Added in API 34; before that `getHost` is the only answer there is.
            try { return service.getHostAddresses(); }
            catch (Throwable ignored) { return Collections.emptyList(); }
        }

        private String text(NsdServiceInfo service, String key) {
            Map<String, byte[]> attributes = service.getAttributes();
            byte[] value = attributes == null ? null : attributes.get(key);
            return value == null ? "" : new String(value, StandardCharsets.UTF_8);
        }

        /**
         * On the main thread: the reply goes to `JavaScriptReplyProxy`, which is `@UiThread`, and from another thread
         * Capacitor swallows the throw and the promise never settles.
         */
        private void finish() {
            if (!settled.compareAndSet(false, true)) return;
            try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) {}
            clock.shutdownNow();
            JSArray servers = new JSArray();
            synchronized (found) { for (JSObject entry : found.values()) servers.put(entry); }
            JSObject result = new JSObject();
            result.put("servers", servers);
            getActivity().runOnUiThread(() -> call.resolve(result));
        }

        /** Without answering: the call is already gone. */
        void abandon() {
            if (!settled.compareAndSet(false, true)) return;
            try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) {}
            clock.shutdownNow();
        }
    }
}
