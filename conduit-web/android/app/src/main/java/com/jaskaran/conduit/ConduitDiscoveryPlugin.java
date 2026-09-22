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
 * Find Conduit servers on the network this phone is on.
 *
 * The shell's half of `discoverServers()`. The server publishes
 * `_conduit._tcp` carrying its identity id and Ed25519 public half; this
 * browses for it and hands back what was advertised, without judging any of
 * it. Deciding whether an address is usable, and proving the identity before a
 * token is sent, both belong to the web half -- the rule lives in one place
 * and this is not it.
 *
 * Browsing is bounded to the question being asked. `NsdManager` holds the
 * multicast socket while discovery runs, and a standing listener would keep
 * the radio awake for an answer nobody wanted, so discovery starts on the call
 * and is stopped when the window closes whether or not anything was found.
 */
@CapacitorPlugin(name = "ConduitDiscovery")
public class ConduitDiscoveryPlugin extends Plugin {

    private static final String SERVICE_TYPE = "_conduit._tcp.";
    private static final long MIN_TIMEOUT_MS = 500;
    private static final long MAX_TIMEOUT_MS = 10_000;

    @PluginMethod
    public void discover(PluginCall call) {
        long timeout = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, call.getInt("timeoutMs", 3000).longValue()));
        NsdManager nsd = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        if (nsd == null) {
            // No responder on this device: nothing found, which is a state the
            // surface above already draws.
            call.resolve(empty());
            return;
        }
        new Browse(nsd, call).run(timeout);
    }

    private static JSObject empty() {
        JSObject result = new JSObject();
        result.put("servers", new JSArray());
        return result;
    }

    /**
     * One bounded browse.
     *
     * Resolution is serialised because `resolveService` takes one at a time on
     * older Android and fails the second with FAILURE_ALREADY_ACTIVE rather
     * than queueing it -- a network with three servers on it would otherwise
     * return one.
     */
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
            // Every address the host answers to, not only the first: which one
            // is reachable is the web half's rule, and it needs the choice.
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

        private void finish() {
            if (!settled.compareAndSet(false, true)) return;
            try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) {}
            clock.shutdownNow();
            JSArray servers = new JSArray();
            synchronized (found) { for (JSObject entry : found.values()) servers.put(entry); }
            JSObject result = new JSObject();
            result.put("servers", servers);
            call.resolve(result);
        }
    }
}
