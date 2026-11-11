package com.jaskaran.conduit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.jaskaran.conduit.FloatMachine.State;

public class ConduitFloatService extends Service {
    static final String VISIBLE = "conduit.float.VISIBLE";
    static final String RESTORE = "conduit.float.RESTORE";
    private static final String OFF = "conduit.float.OFF";
    private static final int NOTIFICATION = 4103;
    private static boolean appForeground;
    private static ConduitFloatService active;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** Off the worker, which may be busy sending or recording for seconds. */
    private static final ExecutorService THUMBS = Executors.newSingleThreadExecutor();
    private final FloatMachine machine = new FloatMachine();
    private FloatWindow window;
    private FloatRecorder recorder;
    private FloatSender sender;
    private volatile String errorText = "Couldn't send — open Conduit";
    private FloatRecorder.Capture capture;
    private String liveText = "";
    private volatile ConduitFloatLive live;
    private ConduitFloatCaption caption;
    private File recording;
    private boolean microphoneReady;
    static boolean microphoneReadyNow() { return active != null && active.microphoneReady; }
    private volatile boolean destroyed;
    private volatile int generation;
    private long sentAt;
    private FloatRadial radial;
    private FloatTarget target = FloatTarget.jbot();
    private FloatPanel panel;
    private final java.util.List<ConduitContext.Result> gathered = new java.util.ArrayList<>();
    /** Each held capture's miniature, in the same order as gathered. */
    private final java.util.List<android.graphics.Bitmap> thumbs = new java.util.ArrayList<>();
    private boolean capturing;
    private long capturingSince;
    private int gatheredGeneration;
    private FloatCaptures captures;
    private FloatShot shot;
    private boolean reopenAfterCancel;
    /**
     * The machine still reads HANDLE while the microphone opens (FloatRecorder.begin), so a release or cancel asked
     * in that moment is kept here and done as the recording starts.
     */
    private enum Opening { NONE, OPENING, RELEASED, CANCELLED }
    private Opening opening = Opening.NONE;

    private boolean radialUp() { return radial != null && (radial.isOpen() || radial.isDictating()); }

    private void updateDiscard() {
        if (window == null) return;
        boolean holding = !gathered.isEmpty();
        State state = machine.state();
        window.setAttention(holding || radialUp());
        android.graphics.Rect card = FloatCaptures.cardRect(this, window.handleCentre(), window.handleHeight());
        if (radial != null) radial.setHeld(holding, FloatCaptures.discardCentre(this, card, gathered.size()));
        boolean show = holding && !appForeground
            && (state == State.HANDLE || state == State.RECORDING || state == State.STOPPING || state == State.ERROR);
        if (captures == null) captures = new FloatCaptures(this, () -> { if (machine.state() == State.HANDLE && !radialUp()) openRadial(); });
        if (show) captures.show(thumbs, window.right(), card);
        else if (holding && (state == State.SENDING || state == State.SENT)) captures.sendAway();
        else captures.hide();
        updateVisibility();
    }

    static void setAppForeground(boolean foreground) {
        appForeground = foreground;
        if (active != null) {
            // An assist from inside the app can leave the radial and a panel open.
            if (foreground) { if (active.radial != null) active.radial.hideNow(); if (active.window != null) active.window.lift(false); active.closePanel(); }
            active.updateVisibility();
            active.updateDiscard();
        }
    }

    static void optionsChanged() { if (active != null) active.updateDiscard(); }

    private boolean summoned;
    private boolean sideKeyRecording;
    private boolean summoning;

    private boolean atRest() {
        return machine.state() == State.HANDLE && !radialUp() && (panel == null || !panel.isOpen()) && gathered.isEmpty()
            && !capturing && !summoning;
    }

    private void updateVisibility() {
        if (window == null) return;
        boolean onlySideKey = prefs().getBoolean("sideKeyOnly", false) && prefs().getBoolean("sideKeyHandled", false);
        if (onlySideKey && summoned && atRest()) summoned = false;
        boolean hidden = away || (appForeground && machine.state() == State.HANDLE) || (onlySideKey && !summoned && atRest());
        window.setVisible(!hidden);
    }

    private void sideKey(ConduitContext.Result result) {
        if (destroyed) { if (result.image != null) result.image.delete(); return; }
        State state = machine.state();
        if (state != State.HANDLE) {
            if (result.image != null) result.image.delete();
            if (state == State.RECORDING && sideKeyRecording) stopRecording(false);
            return;
        }
        closePanel();
        summoned = true;
        summoning = true;
        updateVisibility();
        boolean dictate = prefs().getBoolean("sideKeyDictates", false);
        Runnable next = () -> {
            summoning = false;
            if (destroyed) return;
            updateVisibility();
            if (!appForeground && machine.state() == State.HANDLE && !radialUp()) { if (dictate) sideKeyDictation(); else openRadial(); }
        };
        if (prefs().getBoolean("sideKeyScreenshot", true) && result.error == null && result.image != null) captured(result, next);
        else { if (result.image != null) result.image.delete(); next.run(); }
    }

    private void dictationRow(FloatRadial.Slot slot, int icon) {
        if (!radialUp()) openRadial();
        window.lift(false);
        radial.dictate(slot);
        radial.setTargetIcon(icon);
        updateDiscard();
    }

    private void sideKeyDictation() {
        FloatRadial.Slot slot = "chat".equals(prefs().getString("sideKeyTarget", "jbot")) ? FloatRadial.Slot.NEW_CHAT : FloatRadial.Slot.JBOT;
        openRadial();
        window.lift(false);
        setTarget(targetFor(slot));
        radial.dictate(slot);
        radial.setTargetIcon(slot == FloatRadial.Slot.JBOT ? R.drawable.ic_stat_conduit : R.drawable.float_new_chat);
        window.performHapticFeedback();
        sideKeyRecording = true;
        beginRecording();
    }

    private SharedPreferences prefs() { return ConduitFloatPlugin.preferences(this); }

    @Override public void onCreate() {
        super.onCreate();
        active = this;
        try { ConduitMediaVolume.recover(this); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
        recording = new File(getCacheDir(), "float.wav");
        File previous = new File(getCacheDir(), "jbot-bubble.wav");
        if (!recording.exists() && previous.exists() && !previous.renameTo(recording)) {
            prefs().edit().remove("recordingComplete").apply();
        }
        // A complete WAV survives service/process death for an explicit retry, never an automatic send.
        if (recording.length() > 44 && prefs().getBoolean("recordingComplete", false)) machine.show(State.ERROR);
        else recording.delete();
        recorder = new FloatRecorder(this, recording, main, worker, new FloatRecorder.Listener() {
            @Override public void onStarted(FloatRecorder.Capture next) { recordingStarted(next); }
            @Override public void onLevel(FloatRecorder.Capture current, float loud) {
                if (!destroyed && capture == current && machine.state() == State.RECORDING) {
                    window.updateLevel(loud);
                }
            }
            @Override public void onComplete(FloatRecorder.Capture current, boolean saved) {
                if (destroyed || generation != current.generation) return;
                capture = null;
                if (current.cancel) {
                    discard();
                    show(State.HANDLE);
                    if (reopenAfterCancel) { reopenAfterCancel = false; main.postDelayed(() -> { if (!destroyed && !appForeground && machine.state() == State.HANDLE) openRadial(); }, 160); }
                }
                else if (saved) sendRecording();
                else { discard(); show(State.ERROR); }
            }
            @Override public void onFailure() {
                opening = Opening.NONE;
                errorText = "Microphone is unavailable";
                show(State.ERROR);
            }
        });
        sender = new FloatSender(this, worker, main);
        FloatAssist.receive(result -> main.post(() -> sideKey(result)));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && OFF.equals(intent.getAction())) {
            prefs().edit().putBoolean("enabled", false).apply();
            return stopEarly();
        }
        if (!prefs().getBoolean("enabled", false) || !Settings.canDrawOverlays(this)
            || !ConduitFloatPlugin.microphoneGranted(this)) {
            return stopEarly();
        }
        boolean visibleStart = intent != null && VISIBLE.equals(intent.getAction());
        try {
            // Only a plugin call from a visible activity establishes microphone access.
            // Boot and sticky recovery restore a specialUse idle handle on Android 14+.
            // The side key's assistant session counts as visible too, but should the system refuse the microphone
            // anyway, Float stays up without it (the next dictation opens the app) rather than turning itself off.
            boolean wasReady = microphoneReady;
            microphoneReady |= visibleStart;
            Notification notification = notification();
            try { foreground(notification); }
            catch (SecurityException refused) {
                if (microphoneReady == wasReady) throw refused;
                microphoneReady = wasReady;
                foreground(notification);
            }
            if (window == null) {
                window = new FloatWindow(this, main, new FloatWindow.Listener() {
                    @Override public void onShown() { caption = new ConduitFloatCaption(ConduitFloatService.this); }
                    @Override public void onRefresh() { show(machine.state()); }
                    @Override public void onVisibilityChanged() { updateVisibility(); }
                    @Override public void onPlacementChanged() { updateCaption(); }
                });
                window.create(machine.state(), new FloatView.Listener() {
                    @Override public void onTap() { openRadial(); }
                    @Override public void onHoldStart() { holdStarted(); }
                    @Override public void onHoldMove(float rawX, float rawY) {}
                    @Override public void onHoldEnd(boolean cancelled) { holdEnded(cancelled); }
                    @Override public void onCancel() { cancel(); }
                    @Override public void onSend() { stopRecording(false); }
                    @Override public void onRetry() { retry(); }
                    @Override public void onDragEnded() {
                        window.snapToEdge();
                        // Once the handle has settled on its edge.
                        main.postDelayed(ConduitFloatService.this::updateDiscard, 200);
                    }
                });
                show(machine.state());
            }
            if (machine.state() == State.RECORDING) recorder.applyVolume();
            if (visibleStart && intent.getBooleanExtra("record", false) && machine.state() == State.HANDLE) beginRecording();
            return START_STICKY;
        } catch (RuntimeException error) {
            recorder.restoreVolume();
            prefs().edit().putBoolean("enabled", false).apply();
            return stopEarly();
        }
    }

    /** A service started with startForegroundService that stops before startForeground crashes the app (Android 9+). */
    private int stopEarly() {
        try { foreground(notification()); } catch (RuntimeException refused) {}
        stopSelf();
        return START_NOT_STICKY;
    }

    private void foreground(Notification notification) {
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification,
            microphoneReady ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification,
            microphoneReady ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
        else startForeground(NOTIFICATION, notification);
    }

    private Notification notification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            // Minimum importance folds the required notification away with no status-bar icon. A channel's importance
            // is fixed once made, so the earlier channel is deleted.
            try { manager.deleteNotificationChannel("conduit_float"); } catch (RuntimeException stillInUse) {}
            NotificationChannel channel = new NotificationChannel("conduit_float_quiet", "Float", NotificationManager.IMPORTANCE_MIN);
            channel.setSound(null, null);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent off = PendingIntent.getService(this, 1, new Intent(this, ConduitFloatService.class).setAction(OFF), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, "conduit_float_quiet").setSmallIcon(R.drawable.ic_stat_conduit)
            .setContentTitle("Float").setContentIntent(open).setOngoing(true).setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN).setShowWhen(false)
            .addAction(0, "Turn off", off).build();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (window != null) window.refreshPlacement();
    }

    private void updateCaption() {
        if (caption == null) return;
        if (away) { caption.hideNow(); return; }
        if ((machine.state() == State.RECORDING || machine.state() == State.STOPPING) && !liveText.isEmpty())
            window.showCaption(caption, liveText, targetLine());
        else caption.hide();
    }

    private String targetLine() {
        if (target.kind == FloatTarget.Kind.JBOT) return "To jbot";
        if (target.kind == FloatTarget.Kind.CHAT) return "To " + (target.label == null ? "chat" : target.label);
        return target.projectId == null ? "New chat · No folder" : "New chat · " + target.label;
    }

    private void show(State next) {
        State previous = machine.state();
        if (destroyed || !machine.show(next)) return;
        // Send to belongs to the recording, including when the recorder stops or fails on its own.
        if (previous == State.RECORDING && next != State.RECORDING) closePanel();
        if (next == State.HANDLE) liveText = "";
        if (next != State.RECORDING) sideKeyRecording = false;
        if (next != State.RECORDING && radial != null && radial.isDictating()) radial.close();
        window.show(next, errorText, sentAt);
        updateDiscard();
    }

    private void openApp(boolean record) {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("conduit.float.record", record));
    }

    private FloatRadial.Slot holdTarget() {
        return "chat".equals(prefs().getString("holdTarget", "jbot")) ? FloatRadial.Slot.NEW_CHAT : FloatRadial.Slot.JBOT;
    }

    private void setTarget(FloatTarget next) {
        target = next;
        if (window != null) window.setTarget(next.kind == FloatTarget.Kind.JBOT ? R.drawable.ic_stat_conduit
            : next.kind == FloatTarget.Kind.CHAT ? R.drawable.float_recent : R.drawable.float_new_chat,
            next.kind == FloatTarget.Kind.JBOT ? "jbot" : next.label == null ? "chat" : next.label);
        if (capture != null || machine.state() == State.RECORDING)
            prefs().edit().putString("recordingTarget", next.toJson()).apply();
    }

    private ConduitHubClient hub() {
        String origin = prefs().getString("origin", "");
        return new ConduitHubClient(this, origin, prefs().getString("tokenOrigin", origin));
    }

    private void closePanel() {
        if (panel != null) panel.close();
        panel = null;
    }

    private void openPlaces() {
        closePanel();
        FloatPlacesPanel places = new FloatPlacesPanel(this, hub(), new FloatPlacesPanel.Listener() {
            @Override public void placeChosen(ConduitHubClient.Place place) {
                setTarget(FloatTarget.newChat(place.isChat ? null : place.id, place.isChat ? "New chat" : place.name));
                if (machine.state() == State.HANDLE) {
                    dictationRow(FloatRadial.Slot.WORKSPACE, place.isChat ? R.drawable.float_new_chat
                        : FloatGlyphs.icon(place.isWorkspace && !"monogram".equals(place.appearanceMode) ? place.appearanceValue : "folder"));
                    beginRecording();
                }
            }
            @Override public void closed() { updateDiscard(); }
        });
        panel = places;
        places.show(window.right(), Math.round(window.handleCentre()[1]));
    }

    private void openSendTo() {
        closePanel();
        FloatPlacesPanel places = new FloatPlacesPanel(this, hub(), new FloatPlacesPanel.Listener() {
            @Override public void placeChosen(ConduitHubClient.Place place) {
                FloatTarget next = place == null ? FloatTarget.jbot()
                    : FloatTarget.newChat(place.isChat ? null : place.id, place.isChat ? "New chat" : place.name);
                setTarget(next);
                if (radial != null) radial.setTargetIcon(place == null ? R.drawable.ic_stat_conduit
                    : place.isChat ? R.drawable.float_new_chat : FloatGlyphs.icon(place.isWorkspace && !"monogram".equals(place.appearanceMode) ? place.appearanceValue : "folder"));
                updateCaption();
            }
            @Override public void closed() { updateDiscard(); }
        }, true);
        panel = places;
        places.show(window.right(), Math.round(window.handleCentre()[1]));
    }

    private void openRecent() {
        closePanel();
        final FloatRecentPanel[] recent = new FloatRecentPanel[1];
        recent[0] = new FloatRecentPanel(this, hub(), new FloatRecentPanel.Listener() {
            @Override public void answerByVoice(ConduitHubClient.RecentChat chat) {
                closePanel();
                setTarget(FloatTarget.chat(chat.chatId, chat.title));
                if (machine.state() == State.HANDLE) { dictationRow(FloatRadial.Slot.RECENT, R.drawable.float_recent); beginRecording(); }
            }
            @Override public void answerTyped(ConduitHubClient.RecentChat chat, String text) {
                String origin = prefs().getString("origin", "");
                String delivery = java.util.UUID.randomUUID().toString();
                sender.send(FloatTarget.chat(chat.chatId, chat.title), null, text, gatheredFiles(),
                    delivery, origin, prefs().getString("tokenOrigin", origin),
                    () -> !destroyed, new FloatSender.Listener() {
                        private String failure = "Couldn't send";
                        @Override public void onFailureText(String line) { failure = line; }
                        @Override public void onComplete(boolean sent, String chatIdOrNull) {
                            try { FloatSender.clearDelivery(ConduitFloatService.this, delivery); } catch (IllegalStateException ignored) {}
                            if (sent) { dropGathered(); recent[0].sent(); } else recent[0].failed(failure);
                        }
                    });
            }
            @Override public void openInConduit(ConduitHubClient.RecentChat chat) {
                closePanel();
                FloatRecentPanel.openInConduit(ConduitFloatService.this, "", chat);
            }
            @Override public void closed() { updateDiscard(); }
        });
        panel = recent[0];
        recent[0].show(window.right(), Math.round(window.handleCentre()[1]));
    }

    private FloatRadial radial() {
        if (radial == null) radial = new FloatRadial(this, new FloatRadial.Listener() {
            @Override public void chosen(FloatRadial.Slot slot) { radialChosen(slot); updateDiscard(); }
            @Override public void dismissed() { window.lift(false); updateDiscard(); }
            @Override public void discard() { dropGathered(); updateDiscard(); }
            @Override public void retarget() { openSendTo(); }
            @Override public void handleHeld() { holdStarted(); }
            @Override public void handleReleased(boolean cancelled) { holdEnded(cancelled); }
        });
        return radial;
    }

    private void openRadial() {
        ConduitHubClient lists = hub();
        if (lists != null) { FloatPanel.warm("places", lists::places); FloatPanel.warm("recent", () -> lists.recentChats(20)); }
        float[] centre = window.handleCentre();
        int[] screen = window.screenSize();
        android.graphics.Rect card = FloatCaptures.cardRect(this, centre, window.handleHeight());
        radial().open(window.right(), centre[0], centre[1], screen[0], screen[1], !gathered.isEmpty(),
            FloatCaptures.discardCentre(this, card, gathered.size()));
        window.lift(true);
        updateDiscard();
    }

    private void radialChosen(FloatRadial.Slot slot) {
        if (slot == FloatRadial.Slot.SCREENSHOT) { screenshot(); return; }
        if (slot == FloatRadial.Slot.CAMERA) { photo(); return; }
        if (machine.state() != State.HANDLE) return;
        window.lift(false);
        switch (slot) {
            case JBOT: case NEW_CHAT:
                setTarget(targetFor(slot));
                radial.dictate(slot);
                radial.setTargetIcon(slot == FloatRadial.Slot.JBOT ? R.drawable.ic_stat_conduit : R.drawable.float_new_chat);
                beginRecording();
                break;
            // The radial went without fading: the panel takes the screen behind it as its frost.
            case WORKSPACE: openPlaces(); break;
            case RECENT: openRecent(); break;
            default: break;
        }
    }

    /** Off the screen for a capture: nothing may bring the handle back meanwhile. */
    private boolean away;
    private final Runnable captureSafety = () -> {
        if (!destroyed && away) { capturing = false; setAway(false); }
    };

    private void setAway(boolean away) {
        this.away = away;
        if (radial != null) radial.setHidden(away);
        if (captures != null) captures.setHidden(away);
        if (away) { if (caption != null) caption.hideNow(); window.setVisible(false); }
        else { updateVisibility(); updateCaption(); }
    }

    /** A capture that never came back (a consent left open, a camera closed oddly) does not block the next one. */
    private boolean busyCapturing() {
        if (capturing && SystemClock.uptimeMillis() - capturingSince > 15000) { capturing = false; setAway(false); }
        return capturing;
    }

    private void screenshot() {
        if (busyCapturing()) return;
        if (!ConduitContext.screenReaderOn(this)) { needScreenContext(); return; }
        capturing = true;
        capturingSince = SystemClock.uptimeMillis();
        setAway(true);
        main.removeCallbacks(captureSafety);
        main.postDelayed(captureSafety, 15000);
        ConduitContext.screenshot(this, result -> captured(result, null));
    }

    private void needScreenContext() {
        android.widget.Toast.makeText(this, "Screenshot needs Float screen context", android.widget.Toast.LENGTH_SHORT).show();
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel("conduit_float_setup", "Float setup", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        PendingIntent open = PendingIntent.getActivity(this, 2, new Intent(this, MainActivity.class)
                .putExtra(ConduitFloatPlugin.OPEN_SETTINGS, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        manager.notify(SETUP_NOTIFICATION, new NotificationCompat.Builder(this, "conduit_float_setup").setSmallIcon(R.drawable.ic_stat_conduit)
            .setContentTitle("Turn on Float screen context").setContentText("Float's Screenshot needs it. Tap to set it up.")
            .setContentIntent(open).setAutoCancel(true).build());
    }

    private static final int SETUP_NOTIFICATION = 4104;

    private void photo() {
        if (busyCapturing()) return;
        capturing = true;
        capturingSince = SystemClock.uptimeMillis();
        main.removeCallbacks(captureSafety);
        ConduitContext.photo(this, result -> captured(result, null));
    }

    private void captured(ConduitContext.Result result, Runnable then) {
        main.removeCallbacks(captureSafety);
        capturing = false;
        if (destroyed) { if (result.image != null) result.image.delete(); return; }
        setAway(false);
        if (result.error != null || result.image == null) {
            if (result.error != null) android.widget.Toast.makeText(this, result.error, android.widget.Toast.LENGTH_SHORT).show();
            updateDiscard();
            if (then != null) then.run();
            return;
        }
        int heldGeneration = gatheredGeneration;
        boolean flash = !"photo".equals(result.kind);
        THUMBS.execute(() -> {
            android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
            options.inSampleSize = 4;
            android.graphics.Bitmap thumb;
            try { thumb = android.graphics.BitmapFactory.decodeFile(result.image.getPath(), options); }
            catch (RuntimeException | OutOfMemoryError e) { thumb = null; }
            final android.graphics.Bitmap mini = thumb;
            main.post(() -> {
                if (destroyed || heldGeneration != gatheredGeneration) {
                    result.image.delete();
                    if (mini != null) mini.recycle();
                    if (!destroyed && then != null) then.run();
                    return;
                }
                if (shot == null) shot = new FloatShot(this);
                android.graphics.Rect card = FloatCaptures.cardRect(this, window.handleCentre(), window.handleHeight());
                Runnable land = () -> {
                    // A discard during the flight must not put the capture back in the card.
                    if (destroyed || heldGeneration != gatheredGeneration) {
                        result.image.delete();
                        if (mini != null) mini.recycle();
                        // The side key's step still follows (its summoning flag waits on it).
                        if (!destroyed && then != null) then.run();
                        return;
                    }
                    gathered.add(result);
                    thumbs.add(mini);
                    updateDiscard();
                    if (then != null) then.run();
                };
                if (radial == null || !radial.playShot(mini, flash, card, land)) shot.play(mini, flash, card, land);
            });
        });
    }

    private java.util.List<File> gatheredFiles() {
        java.util.List<File> files = new java.util.ArrayList<>();
        for (ConduitContext.Result result : gathered) {
            files.add(result.image);
            if (result.screenText == null || result.screenText.isEmpty()) continue;
            File words = new File(result.image.getParentFile(), result.image.getName().replace(".jpg", "") + ".txt");
            if (!words.exists()) {
                String head = result.appLabel == null ? "" : "On screen in " + result.appLabel + ":\n\n";
                try { java.nio.file.Files.write(words.toPath(), (head + result.screenText).getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
                catch (java.io.IOException failed) { continue; }
            }
            files.add(words);
        }
        return files;
    }

    private void dropGathered() {
        gatheredGeneration++;
        gathered.clear();
        for (android.graphics.Bitmap thumb : thumbs) if (thumb != null) thumb.recycle();
        thumbs.clear();
        ConduitContext.clear(this);
        if (captures != null) captures.hide();
        updateDiscard();
    }

    private void holdStarted() {
        if (machine.state() != State.HANDLE) return;
        setTarget(targetFor(holdTarget()));
        dictationRow(holdTarget(), holdTarget() == FloatRadial.Slot.JBOT ? R.drawable.ic_stat_conduit : R.drawable.float_new_chat);
        beginRecording();
    }

    private void holdEnded(boolean cancelled) {
        if (opening == Opening.OPENING) { opening = cancelled ? Opening.CANCELLED : Opening.RELEASED; return; }
        if (machine.state() != State.RECORDING) return;
        if (cancelled) cancel();
        else stopRecording(false);
    }

    private void beginRecording() {
        if (!microphoneReady) { openApp(true); return; }
        liveText = "";
        if (opening == Opening.NONE) opening = Opening.OPENING;
        recorder.begin(generation + 1);
    }

    private FloatTarget targetFor(FloatRadial.Slot slot) {
        return slot == FloatRadial.Slot.NEW_CHAT ? FloatTarget.newChat(null, "New chat") : FloatTarget.jbot();
    }

    private void recordingStarted(FloatRecorder.Capture next) {
        Opening asked = opening;
        opening = Opening.NONE;
        generation = next.generation;
        capture = next;
        if (asked == Opening.CANCELLED) { recorder.stop(next, true); return; }
        prefs().edit().putBoolean("recordingComplete", false)
            .putString("recordingTarget", target.toJson())
            .putBoolean("recordingRetried", false).putString("recordingId", java.util.UUID.randomUUID().toString())
            .putString("recordingOrigin", prefs().getString("origin", ""))
            .putString("recordingTokenOrigin", prefs().getString("tokenOrigin", "")).commit();
        show(State.RECORDING);
        try {
            if (live != null) live.close();
            String origin = prefs().getString("recordingOrigin", "");
            String tokenOrigin = prefs().getString("recordingTokenOrigin", origin);
            String cookie = CookieManager.getInstance().getCookie(origin);
            final ConduitFloatLive[] client = new ConduitFloatLive[1];
            client[0] = new ConduitFloatLive(origin, cookie, () -> ConduitHubAuth.nativeToken(ConduitFloatService.this, tokenOrigin), text -> main.post(() -> {
                if (!destroyed && live == client[0] && machine.state() != State.HANDLE) {
                    liveText = text;
                    updateCaption();
                }
            }));
            live = next.live = client[0];
            client[0].start();
        } catch (Exception ignored) { /* Live preview is optional. */ }
        if (asked == Opening.RELEASED) stopRecording(false);
    }

    private void stopRecording(boolean cancel) {
        if (capture == null) return;
        recorder.stop(capture, cancel);
        show(State.STOPPING);
    }

    private void retry() {
        if (!prefs().getBoolean("recordingRetried", false) && prefs().getBoolean("recordingComplete", false)) {
            prefs().edit().putBoolean("recordingRetried", true).apply();
            sendRecording();
        } else openApp(false);
    }

    private void discard() {
        if (live != null) { live.close(); live = null; }
        recording.delete();
        try { FloatSender.clearDelivery(this, prefs().getString("recordingId", null)); } catch (IllegalStateException ignored) {}
        prefs().edit().remove("recordingTarget").remove("recordingComplete").remove("recordingOrigin").remove("recordingTokenOrigin").remove("recordingRetried").remove("recordingId").apply();
    }

    private void cancel() {
        if (live != null) { live.close(); live = null; }
        if (capture != null) { reopenAfterCancel = true; stopRecording(true); return; }
        if (opening != Opening.NONE) opening = Opening.CANCELLED;
        generation++;
        sender.cancel();
        discard();
        dropGathered();
        recorder.restoreVolume();
        show(State.HANDLE);
    }

    private void sendRecording() {
        if (!prefs().getBoolean("recordingComplete", false) || recording.length() <= 44) { openApp(false); return; }
        recorder.restoreVolume();
        show(State.SENDING);
        int sending = ++generation;
        String origin = prefs().getString("recordingOrigin", "");
        String tokenOrigin = prefs().getString("recordingTokenOrigin", origin);
        String recordingId = prefs().getString("recordingId", "");
        FloatTarget to = FloatTarget.fromJson(prefs().getString("recordingTarget", null));
        sender.send(to, recording, null, gatheredFiles(), recordingId, origin, tokenOrigin, () -> !destroyed && sending == generation,
            new FloatSender.Listener() {
                @Override public void onFailureText(String text) { errorText = text; }
                @Override public void onComplete(boolean sent, String chatIdOrNull) {
                    if (destroyed || sending != generation) return;
                    if (sent) {
                        discard();
                        dropGathered();
                        sentAt = SystemClock.uptimeMillis();
                        show(State.SENT);
                        main.postDelayed(() -> { if (!destroyed && sending == generation) show(State.HANDLE); }, 1000);
                    } else show(State.ERROR);
                }
            });
    }

    @Override public void onDestroy() {
        destroyed = true;
        FloatAssist.receive(null);
        if (live != null) { live.close(); live = null; }
        if (caption != null) caption.destroy();
        if (active == this) active = null;
        if (radial != null) radial.destroy();
        if (shot != null) shot.cancel();
        if (captures != null) captures.hide();
        closePanel();
        if (window != null) window.stopAnimations();
        generation++;
        main.removeCallbacksAndMessages(null);
        recorder.destroy(capture);
        sender.cancel();
        recorder.restoreVolume();
        if (!prefs().getBoolean("enabled", false)) discard();
        worker.shutdown();
        if (window != null) window.dismiss();
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

}
