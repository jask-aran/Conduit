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
    private final FloatMachine machine = new FloatMachine();
    private FloatWindow window;
    private FloatRecorder recorder;
    private FloatSender sender;
    /** What the pill says when a send fails: the hub's own message, or why it could not be reached. */
    private volatile String errorText = "Couldn't send — open Conduit";
    private FloatRecorder.Capture capture;
    private String liveText = "";
    private volatile ConduitFloatLive live;
    /** The words heard so far, beside the pill, when the voice model transcribes live. */
    private ConduitFloatCaption caption;
    private File recording;
    private boolean microphoneReady;
    private volatile boolean destroyed;
    private volatile int generation;
    private long sentAt;
    private FloatRadial radial;
    /** Where the message being recorded goes: the radial's choice, or the hold's default until a slot locks it. */
    private FloatTarget target = FloatTarget.jbot();
    private FloatPanel panel;
    /** Screenshots and photos gathered for the next message, oldest first. Sent with it, or dropped on cancel. */
    private final java.util.List<ConduitContext.Result> gathered = new java.util.ArrayList<>();
    private boolean capturing;
    private FloatDiscard discardBubble;

    /** The ✕ beside the handle while captures wait at rest; hidden while the radial, a panel or the pill is open. */
    private void updateDiscard() {
        if (window == null) return;
        boolean holding = !gathered.isEmpty();
        window.setAttention(holding);
        boolean show = holding && !capturing && machine.state() == State.HANDLE && !appForeground
            && (radial == null || !radial.isOpen()) && (panel == null || !panel.isOpen());
        if (!show) { if (discardBubble != null) discardBubble.hide(); return; }
        if (discardBubble == null) discardBubble = new FloatDiscard(this, this::dropGathered);
        discardBubble.show(window.right(), window.handleCentre());
    }

    static void setAppForeground(boolean foreground) {
        appForeground = foreground;
        if (active != null) { active.updateVisibility(); active.updateDiscard(); }
    }

    private void updateVisibility() {
        if (window != null) window.setVisible(!(appForeground && machine.state() == State.HANDLE));
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
                if (current.cancel) { discard(); show(State.HANDLE); }
                else if (saved) sendRecording();
                else { discard(); show(State.ERROR); }
            }
            @Override public void onFailure() {
                errorText = "Microphone is unavailable";
                show(State.ERROR);
            }
        });
        sender = new FloatSender(this, worker, main);
        // The assistant (a long press on home) hands Float the screen: held like a screenshot, then where it goes.
        FloatAssist.receive(result -> main.post(() -> {
            captured(result);
            if (result.error == null && window != null && machine.state() == State.HANDLE) openRadial();
        }));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && OFF.equals(intent.getAction())) {
            prefs().edit().putBoolean("enabled", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!prefs().getBoolean("enabled", false) || !Settings.canDrawOverlays(this)
            || !ConduitFloatPlugin.microphoneGranted(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        boolean visibleStart = intent != null && VISIBLE.equals(intent.getAction());
        try {
            // Only a plugin call from a visible activity establishes microphone access.
            // Boot and sticky recovery restore a specialUse idle handle on Android 14+.
            microphoneReady |= visibleStart;
            Notification notification = notification();
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification,
                microphoneReady ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification,
                microphoneReady ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
            else startForeground(NOTIFICATION, notification);
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
                        // The ✕ follows once the handle has settled on its edge.
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
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    private Notification notification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            // Minimum importance: Android requires the foreground service's notification, but it folds away with no
            // status-bar icon. A channel's importance is fixed once made, so the old LOW channel is replaced.
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

    /** The caption shows while listening and as it stops, once there are words. */
    private void updateCaption() {
        if (caption == null) return;
        if ((machine.state() == State.RECORDING || machine.state() == State.STOPPING) && !liveText.isEmpty())
            window.showCaption(caption, liveText);
        else caption.hide();
    }

    private void show(State next) {
        if (destroyed || !machine.show(next)) return;
        if (next == State.HANDLE) liveText = "";
        window.show(next, errorText, sentAt);
        updateDiscard();
    }

    private void openApp(boolean record) {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("conduit.float.record", record));
    }

    /** What a hold talks to before a slot is chosen: Settings' choice, jbot unless it says a new chat. */
    private FloatRadial.Slot holdTarget() {
        return "chat".equals(prefs().getString("holdTarget", "jbot")) ? FloatRadial.Slot.NEW_CHAT : FloatRadial.Slot.JBOT;
    }

    /** Where the message goes now; while recording, it travels with the recording (a retry goes to the same place). */
    private void setTarget(FloatTarget next) {
        target = next;
        if (capture != null || machine.state() == State.RECORDING)
            prefs().edit().putString("recordingTarget", next.toJson()).apply();
    }

    private ConduitHubClient hub() {
        String origin = prefs().getString("origin", "");
        return new ConduitHubClient(this, origin, prefs().getString("tokenOrigin", origin));
    }

    private void closePanel() {
        if (panel != null && panel.isOpen()) panel.close();
        panel = null;
    }

    /** Workspace: where a new chat goes. Chosen while recording (a locked hold), it retargets; at rest, it records. */
    private void openPlaces() {
        closePanel();
        FloatPlacesPanel places = new FloatPlacesPanel(this, hub(), new FloatPlacesPanel.Listener() {
            @Override public void placeChosen(ConduitHubClient.Place place) {
                setTarget(FloatTarget.newChat(place.isChat ? null : place.id, place.isChat ? "New chat" : place.name));
                if (machine.state() == State.HANDLE) beginRecording();
            }
            @Override public void closed() { updateDiscard(); }
        });
        panel = places;
        places.show(window.right(), Math.round(window.handleCentre()[1]));
    }

    /** Recent: the latest replies; answer one by voice (records to that chat) or by typing (sent at once). */
    private void openRecent() {
        closePanel();
        final FloatRecentPanel[] recent = new FloatRecentPanel[1];
        recent[0] = new FloatRecentPanel(this, hub(), new FloatRecentPanel.Listener() {
            @Override public void answerByVoice(ConduitHubClient.RecentChat chat) {
                closePanel();
                setTarget(FloatTarget.chat(chat.chatId, chat.title));
                if (machine.state() == State.HANDLE) beginRecording();
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
            @Override public void chosen(FloatRadial.Slot slot) { window.lift(false); radialChosen(slot); updateDiscard(); }
            @Override public void dismissed() { window.lift(false); updateDiscard(); }
        });
        return radial;
    }

    /** The radial around the handle; the handle stays lit while it is open, as it does while held. */
    private void openRadial() {
        float[] centre = window.handleCentre();
        int[] screen = window.screenSize();
        radial().open(window.right(), centre[0], centre[1], screen[0], screen[1]);
        window.lift(true);
        updateDiscard();
    }

    /** A tap's radial: a target starts recording to it. Workspace, Recent and the context slots come with their panels. */
    private void radialChosen(FloatRadial.Slot slot) {
        if (machine.state() != State.HANDLE) return;
        switch (slot) {
            case JBOT: case NEW_CHAT: setTarget(targetFor(slot)); beginRecording(); break;
            // Gone at once, not faded: the panel may take the screen behind it as its frost.
            case WORKSPACE: radial.hideNow(); openPlaces(); break;
            case RECENT: radial.hideNow(); openRecent(); break;
            case SCREENSHOT: screenshot(); break;
            case CAMERA: photo(); break;
            default: break;
        }
    }

    /**
     * A screenshot of what is under Float: Float, its caption and the radial leave the screen first (ConduitContext
     * waits two frames), and come back with the capture held for the next message.
     */
    private void screenshot() {
        if (capturing) return;
        capturing = true;
        if (radial != null) radial.hideNow();
        if (caption != null) caption.hide();
        window.setVisible(false);
        updateDiscard();
        ConduitContext.screenshot(this, this::captured);
    }

    private void photo() {
        if (capturing) return;
        capturing = true;
        ConduitContext.photo(this, this::captured);
    }

    private void captured(ConduitContext.Result result) {
        capturing = false;
        if (destroyed) { if (result.image != null) result.image.delete(); return; }
        updateVisibility();
        updateDiscard();
        if (result.error != null) {
            android.widget.Toast.makeText(this, result.error, android.widget.Toast.LENGTH_SHORT).show();
            return;
        }
        gathered.add(result);
        window.setGathered(gathered.size());
        updateDiscard();
    }

    /** The gathered captures as files to send, in order: each picture, then its screen text when there is some. */
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

    /** The gathered captures are spent (sent) or let go (cancelled). */
    private void dropGathered() {
        gathered.clear();
        ConduitContext.clear(this);
        if (window != null) window.setGathered(0);
        updateDiscard();
    }

    /**
     * Hold to talk (a setting, off by default): a hold opens the recorder pill at once, to the hold's target; letting
     * go sends; letting go after dragging well away cancels.
     */
    private void holdStarted() {
        if (machine.state() != State.HANDLE) return;
        setTarget(targetFor(holdTarget()));
        beginRecording();
    }

    private void holdEnded(boolean cancelled) {
        if (machine.state() != State.RECORDING) return;
        if (cancelled) cancel();
        else stopRecording(false);
    }

    private void beginRecording() {
        if (!microphoneReady) { openApp(true); return; }
        liveText = "";
        recorder.begin(generation + 1);
    }

    /** The radial's slot as a send target. Workspace and Recent bring their own once their panels choose one. */
    private FloatTarget targetFor(FloatRadial.Slot slot) {
        return slot == FloatRadial.Slot.NEW_CHAT ? FloatTarget.newChat(null, "New chat") : FloatTarget.jbot();
    }

    private void recordingStarted(FloatRecorder.Capture next) {
        generation = next.generation;
        capture = next;
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
        if (capture != null) { stopRecording(true); return; }
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
        if (discardBubble != null) discardBubble.hide();
        closePanel();
        if (window != null) window.stopAnimations();
        generation++;
        main.removeCallbacksAndMessages(null);
        recorder.destroy(capture);
        sender.cancel();
        recorder.restoreVolume();
        // Preserve only a failed, completed recording while enabled. Turning off also discards the retry.
        if (!prefs().getBoolean("enabled", false)) discard();
        worker.shutdown();
        if (window != null) window.dismiss();
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

}
