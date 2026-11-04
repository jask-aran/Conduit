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
    private FloatRadial.Slot target = FloatRadial.Slot.JBOT;

    static void setAppForeground(boolean foreground) {
        appForeground = foreground;
        if (active != null) active.updateVisibility();
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
                    @Override public void onTap() { openRadial(false); }
                    @Override public void onHoldStart() { holdStarted(); }
                    @Override public void onHoldMove(float rawX, float rawY) { if (radial != null) radial.track(rawX, rawY); }
                    @Override public void onHoldEnd(boolean cancelled) { holdEnded(cancelled); }
                    @Override public void onCancel() { cancel(); }
                    @Override public void onSend() { stopRecording(false); }
                    @Override public void onRetry() { retry(); }
                    @Override public void onDragEnded() { window.snapToEdge(); }
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
    }

    private void openApp(boolean record) {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("conduit.float.record", record));
    }

    /** What a hold talks to before a slot is chosen: Settings' choice, jbot unless it says a new chat. */
    private FloatRadial.Slot holdTarget() {
        return "chat".equals(prefs().getString("holdTarget", "jbot")) ? FloatRadial.Slot.NEW_CHAT : FloatRadial.Slot.JBOT;
    }

    private FloatRadial radial() {
        if (radial == null) radial = new FloatRadial(this, new FloatRadial.Listener() {
            @Override public void chosen(FloatRadial.Slot slot) { radialChosen(slot); }
            @Override public void dismissed() {}
        });
        return radial;
    }

    private void openRadial(boolean hold) {
        float[] centre = window.handleCentre();
        int[] screen = window.screenSize();
        radial().open(window.right(), centre[0], centre[1], screen[0], screen[1], hold);
    }

    /** A tap's radial: a target starts recording to it. Workspace, Recent and the context slots come with their panels. */
    private void radialChosen(FloatRadial.Slot slot) {
        if (machine.state() != State.HANDLE) return;
        switch (slot) {
            case JBOT: case NEW_CHAT: target = slot; beginRecording(); break;
            case WORKSPACE: case RECENT: openApp(false); break;
            default: break;
        }
    }

    /** A hold records at once, to the hold's target, with the radial around the finger to lock it elsewhere. */
    private void holdStarted() {
        if (machine.state() != State.HANDLE) return;
        target = holdTarget();
        window.setHeld(true);
        beginRecording();
        if (machine.state() == State.RECORDING) openRadial(true);
        else window.setHeld(false);
    }

    /**
     * The hold let go. On Cancel (or taken away): discarded. On a target: locked to it, hands free, the pill open with
     * Send. Anywhere else: sent to the hold's target.
     */
    private void holdEnded(boolean cancelled) {
        FloatRadial.Slot slot = radial == null ? null : radial.release();
        if (machine.state() != State.RECORDING) { window.setHeld(false); return; }
        if (cancelled || slot == FloatRadial.Slot.CANCEL) {
            window.setHeld(false);
            cancel();
        } else if (slot != null && slot.target()) {
            target = slot;
            window.setHeld(false);
        } else {
            window.setHeld(false);
            stopRecording(false);
        }
    }

    private void beginRecording() {
        if (!microphoneReady) { openApp(true); return; }
        liveText = "";
        recorder.begin(generation + 1);
    }

    private void recordingStarted(FloatRecorder.Capture next) {
        generation = next.generation;
        capture = next;
        prefs().edit().putBoolean("recordingComplete", false)
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
        prefs().edit().remove("recordingComplete").remove("recordingOrigin").remove("recordingTokenOrigin").remove("recordingRetried").remove("recordingId").apply();
    }

    private void cancel() {
        if (live != null) { live.close(); live = null; }
        if (capture != null) { stopRecording(true); return; }
        generation++;
        sender.cancel();
        discard();
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
        sender.send(recording, origin, tokenOrigin, recordingId, () -> !destroyed && sending == generation,
            new FloatSender.Listener() {
                @Override public void onFailureText(String text) { errorText = text; }
                @Override public void onComplete(boolean sent) {
                    if (destroyed || sending != generation) return;
                    if (sent) {
                        discard();
                        sentAt = SystemClock.uptimeMillis();
                        show(State.SENT);
                        main.postDelayed(() -> { if (!destroyed && sending == generation) show(State.HANDLE); }, 1000);
                    } else show(State.ERROR);
                }
            });
    }

    @Override public void onDestroy() {
        destroyed = true;
        if (live != null) { live.close(); live = null; }
        if (caption != null) caption.destroy();
        if (active == this) active = null;
        if (radial != null) radial.destroy();
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
