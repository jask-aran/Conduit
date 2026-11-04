package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.app.Dialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Rect;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextPaint;
import android.text.TextUtils;
import android.provider.Settings;
import android.util.Base64;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.view.WindowInsets;
import android.view.WindowMetrics;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import java.io.File;
import java.io.FileInputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONTokener;

public class ConduitFloatService extends Service {
    static final String VISIBLE = "conduit.float.VISIBLE";
    static final String RESTORE = "conduit.float.RESTORE";
    private static final String OFF = "conduit.float.OFF";
    private static final int NOTIFICATION = 4103;
    private static final int MAX_PCM_BYTES = 16_000 * 2 * 300;
    private static boolean appForeground;
    private static ConduitFloatService active;
    private enum State { HANDLE, RECORDING, STOPPING, SENDING, ERROR, SENT }
    private final String volumeOwner = "float:" + java.util.UUID.randomUUID();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private WindowManager windows;
    private WindowManager.LayoutParams position;
    private FloatView control;
    private Dialog overlay;
    private Window overlayWindow;
    private final GradientDrawable frost = new GradientDrawable() {
        @Override public void getOutline(Outline outline) {
            super.getOutline(outline);
            outline.setAlpha(1); // The translucent stroke must not suppress the lift shadow.
        }
    };
    private java.util.function.Consumer<Boolean> blurListener;
    private boolean blurEnabled;
    private ValueAnimator morph;
    private int frameWidth, frameHeight;
    private float openness;
    private State state = State.HANDLE;
    /** What the pill says when a send fails: the hub's own message, or why it could not be reached. */
    private volatile String errorText = "Couldn't send — open Conduit";
    private Capture capture;
    private File recording;
    private volatile HttpURLConnection uploading;
    private boolean microphoneReady;
    private volatile boolean destroyed;
    private volatile int generation;
    private float level;
    private int availableWidth, availableHeight;
    private ValueAnimator snap;

    static void setAppForeground(boolean foreground) {
        appForeground = foreground;
        if (active != null) active.updateVisibility();
    }

    private void updateVisibility() {
        if (overlayWindow != null) overlayWindow.getDecorView().setVisibility(
            appForeground && state == State.HANDLE ? View.GONE : View.VISIBLE);
    }

    private SharedPreferences prefs() { return ConduitFloatPlugin.preferences(this); }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override public void onCreate() {
        super.onCreate();
        active = this;
        try { ConduitMediaVolume.recover(this); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
        windows = (WindowManager) getSystemService(WINDOW_SERVICE);
        recording = new File(getCacheDir(), "float.wav");
        File previous = new File(getCacheDir(), "jbot-bubble.wav");
        if (!recording.exists() && previous.exists() && !previous.renameTo(recording)) {
            prefs().edit().remove("recordingComplete").apply();
        }
        // A complete WAV survives service/process death for an explicit retry, never an automatic send.
        if (recording.length() > 44 && prefs().getBoolean("recordingComplete", false)) state = State.ERROR;
        else recording.delete();
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
            if (control == null) {
                control = new FloatView();
                // A Dialog supplies the public Window background-blur API to this service overlay.
                overlay = new Dialog(this, R.style.ConduitFloatTheme);
                overlay.setCancelable(false);
                overlayWindow = overlay.getWindow();
                overlayWindow.setType(Build.VERSION.SDK_INT >= 26
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
                overlayWindow.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
                overlayWindow.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
                overlayWindow.setBackgroundDrawable(frost);
                overlayWindow.setContentView(control);
                View decor = overlayWindow.getDecorView();
                decor.setPadding(0, 0, 0, 0);
                decor.setElevation(dp(8));
                if (Build.VERSION.SDK_INT >= 28) {
                    decor.setOutlineAmbientShadowColor(0x1a000000);
                    decor.setOutlineSpotShadowColor(0x1a000000);
                }
                position = overlayWindow.getAttributes();
                position.format = PixelFormat.TRANSLUCENT;
                if (Build.VERSION.SDK_INT >= 30) {
                    position.setFitInsetsTypes(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    position.setFitInsetsIgnoringVisibility(true);
                }
                place();
                frameWidth = controlWidth();
                frameHeight = controlHeight();
                openness = state == State.HANDLE ? 0 : 1;
                updateFrame();
                overlay.show();
                if (Build.VERSION.SDK_INT >= 31) {
                    blurListener = enabled -> { blurEnabled = enabled; updateFrost(); };
                    windows.addCrossWindowBlurEnabledListener(main::post, blurListener);
                    blurEnabled = windows.isCrossWindowBlurEnabled();
                    updateFrost();
                }
                control.setOnApplyWindowInsetsListener((view, insets) -> {
                    view.post(() -> {
                        if (!destroyed && updateBounds()) { place(); show(state); }
                    });
                    return insets;
                });
                show(state);
            }
            if (state == State.RECORDING) applyVolume();
            if (visibleStart && intent.getBooleanExtra("record", false) && state == State.HANDLE) beginRecording();
            return START_STICKY;
        } catch (RuntimeException error) {
            ConduitMediaVolume.restoreSafely(this, volumeOwner);
            prefs().edit().putBoolean("enabled", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    private Notification notification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel("conduit_float", "Float", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent off = PendingIntent.getService(this, 1, new Intent(this, ConduitFloatService.class).setAction(OFF), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, "conduit_float").setSmallIcon(R.drawable.ic_stat_conduit)
            .setContentTitle("Float").setContentIntent(open).setOngoing(true).setSilent(true)
            .addAction(0, "Turn off", off).build();
    }

    private boolean updateBounds() {
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowMetrics metrics = windows.getCurrentWindowMetrics();
            android.graphics.Insets insets = metrics.getWindowInsets().getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            width = metrics.getBounds().width() - insets.left - insets.right;
            height = metrics.getBounds().height() - insets.top - insets.bottom;
        } else if (control != null && control.isAttachedToWindow()) {
            Rect frame = new Rect();
            control.getWindowVisibleDisplayFrame(frame);
            width = frame.width();
            height = frame.height();
        }
        width = Math.max(1, width);
        height = Math.max(1, height);
        boolean changed = width != availableWidth || height != availableHeight;
        availableWidth = width;
        availableHeight = height;
        return changed;
    }

    private int controlWidth() {
        // The pill: 4 + 36 (cancel) + 6 + 56 (level) + 6 + 36 (send) + 4. At rest, a 44dp bubble.
        float width = PILL;
        if (state == State.HANDLE) width = HANDLE_W;
        else if (sending()) width = SENDING;
        else if (state == State.ERROR) {
            TextPaint text = new TextPaint();
            text.setTextSize(dp(13));
            width = Math.max(PILL, Math.min(304, 4 + 36 + 10 + 12 + text.measureText(errorText) / getResources().getDisplayMetrics().density));
        }
        return Math.min(availableWidth, dp(width));
    }

    private int controlHeight() { return Math.min(availableHeight, dp(state == State.HANDLE ? HANDLE_H : sending() ? SENDING : 44)); }
    /** Sent off: the pill gathers into a small round bubble, a spinner and then a tick, and goes back to rest. */
    private boolean sending() { return state == State.STOPPING || state == State.SENDING || state == State.SENT; }
    private static final float SENDING = 40;
    private long sentAt;
    /** The pill's width in dp, and how far Float rests from the screen's edge. */
    private static final float PILL = 148, EDGE = 3;
    /** At rest: a small upright capsule, close to the edge. */
    private static final float HANDLE_W = 32, HANDLE_H = 40;

    private void place() {
        if (snap != null) { snap.cancel(); snap = null; }
        updateBounds();
        position.gravity = Gravity.TOP | (prefs().getBoolean("right", true) ? Gravity.RIGHT : Gravity.LEFT);
        position.x = dp(EDGE);
        position.y = Math.round(Math.max(0, availableHeight - controlHeight())
            * Math.max(0, Math.min(1, prefs().getFloat("y", .45f))));
    }

    private void updateFrost() {
        if (destroyed) return;
        boolean right = prefs().getBoolean("right", true);
        float r = Math.min(frameWidth, frameHeight) / 2f;
        // Always fully round (a bubble at rest, a pill open): the window's blur follows a uniform outline.
        boolean blurred = blurEnabled;
        frost.setCornerRadii(null);
        frost.setCornerRadius(r);
        // v2's white fill over its dark core ground; a denser core when blur is unavailable.
        frost.setColor(androidx.core.graphics.ColorUtils.compositeColors(0x2bffffff,
            blurred ? 0xe63a3b3f : 0xfa3a3b3f));
        frost.setStroke(dp(1), 0x4dffffff);
        if (Build.VERSION.SDK_INT >= 31) overlayWindow.setBackgroundBlurRadius(blurred ? dp(24) : 0);
        control.invalidate();
    }

    private void updateFrame() {
        position.width = frameWidth;
        position.height = frameHeight;
        overlayWindow.setAttributes(position);
        updateFrost();
        control.requestLayout();
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (control != null) { place(); show(state); }
    }

    private void show(State next) {
        if (destroyed) return;
        if (morph != null) { morph.cancel(); morph = null; }
        state = next;
        level = 0;
        control.buttons();
        control.setClickable(next == State.HANDLE || next == State.ERROR);
        control.setContentDescription(next == State.HANDLE ? "Float. Talk to jbot. Drag to move."
            : next == State.RECORDING ? "Recording" : next == State.ERROR ? errorText + ". Tap to retry or open Conduit."
            : next == State.SENT ? "Sent" : "Sending to jbot");
        updateVisibility();
        int startY = position.y;
        place();
        int targetY = position.y;
        int startWidth = frameWidth, startHeight = frameHeight;
        int targetWidth = controlWidth(), targetHeight = controlHeight();
        float startOpen = openness, targetOpen = next == State.HANDLE ? 0 : 1;
        if (startWidth == targetWidth && startHeight == targetHeight) {
            openness = targetOpen;
            updateFrame();
            return;
        }
        morph = ValueAnimator.ofFloat(0, 1);
        morph.setDuration(220);
        morph.setInterpolator(new android.view.animation.PathInterpolator(.2f, 0f, 0f, 1f));
        morph.addUpdateListener(animation -> {
            float progress = (float) animation.getAnimatedValue();
            frameWidth = Math.round(startWidth + (targetWidth - startWidth) * progress);
            frameHeight = Math.round(startHeight + (targetHeight - startHeight) * progress);
            position.y = Math.round(startY + (targetY - startY) * progress);
            openness = startOpen + (targetOpen - startOpen) * progress;
            updateFrame();
        });
        morph.start();
    }

    private void openApp(boolean record) {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("conduit.float.record", record));
    }

    private void applyVolume() {
        String mode = prefs().getString("otherAudio", "keep");
        if ("keep".equals(mode)) ConduitMediaVolume.restore(this, volumeOwner);
        else ConduitMediaVolume.lower(this, volumeOwner, "mute".equals(mode) ? 0 : prefs().getInt("otherAudioLevel", 30));
    }

    private static final class Capture {
        final AudioRecord audio;
        final int generation;
        volatile boolean stop, cancel;
        Capture(AudioRecord audio, int generation) { this.audio = audio; this.generation = generation; }
    }

    private void beginRecording() {
        if (!microphoneReady) { openApp(true); return; }
        AudioRecord audio = null;
        try {
            int bufferSize = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (bufferSize <= 0) throw new IllegalStateException("Microphone is unavailable");
            // MIC, as the app's own dictation records: VOICE_RECOGNITION moved a Bluetooth headset to its call profile and
            // dropped music to call quality.
            audio = new AudioRecord(MediaRecorder.AudioSource.MIC, 16_000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(bufferSize, 6400));
            if (audio.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Microphone is unavailable");
            AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
            for (AudioDeviceInfo input : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                if (input.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                    if (!audio.setPreferredDevice(input)) throw new IllegalStateException("Phone microphone is unavailable");
                    break;
                }
            }
            applyVolume();
            audio.startRecording();
            if (audio.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Microphone did not start");
            Capture next = new Capture(audio, ++generation);
            capture = next;
            prefs().edit().putBoolean("recordingComplete", false)
                .putBoolean("recordingRetried", false).putString("recordingId", java.util.UUID.randomUUID().toString())
                .putString("recordingOrigin", prefs().getString("origin", ""))
                .putString("recordingTokenOrigin", prefs().getString("tokenOrigin", "")).commit();
            show(State.RECORDING);
            worker.execute(() -> record(next));
        } catch (Exception error) {
            if (audio != null) audio.release();
            ConduitMediaVolume.restoreSafely(this, volumeOwner);
            errorText = "Microphone is unavailable";
            show(State.ERROR);
        }
    }

    private void record(Capture current) {
        boolean complete = false;
        try (RandomAccessFile file = new RandomAccessFile(recording, "rw")) {
            file.setLength(0);
            file.write(new byte[44]);
            byte[] buffer = new byte[640]; // 20ms of PCM; the meter smooths these real RMS samples over 80ms.
            int bytes = 0;
            while (!current.stop && bytes < MAX_PCM_BYTES) {
                int count = current.audio.read(buffer, 0, Math.min(buffer.length, MAX_PCM_BYTES - bytes));
                if (count <= 0) {
                    if (!current.stop) throw new IllegalStateException("Microphone read failed");
                    break;
                }
                file.write(buffer, 0, count);
                bytes += count;
                double sum = 0;
                for (int i = 0; i + 1 < count; i += 2) {
                    short sample = (short) ((buffer[i] & 255) | (buffer[i + 1] << 8));
                    sum += (double) sample * sample;
                }
                // Loudness on a dB scale, as hearing goes: -54 dBFS (a quiet room) is still, -18 (close speech) is full.
                double db = 20 * Math.log10(Math.max(1e-6, Math.sqrt(sum / Math.max(1, count / 2)) / 32768));
                float loud = (float) Math.max(0, Math.min(1, (db + 54) / 36));
                main.post(() -> { if (capture == current && state == State.RECORDING) { level += (loud - level) * (loud > level ? .6f : .18f); control.invalidate(); } });
            }
            if (!current.cancel && bytes > 0) {
                file.seek(0);
                file.write(wavHeader(bytes));
                complete = true;
            }
        } catch (Exception error) {
            // Keep credentials and provider replies out of the log.
        } finally {
            try { current.audio.stop(); } catch (RuntimeException ignored) {}
            current.audio.release();
            ConduitMediaVolume.restoreSafely(this, volumeOwner);
        }
        boolean saved = complete;
        // Complete is committed before any upload; incomplete recordings are never retried after process death.
        prefs().edit().putBoolean("recordingComplete", saved && !current.cancel).commit();
        main.post(() -> {
            if (destroyed || generation != current.generation) return;
            capture = null;
            if (current.cancel) { discard(); show(State.HANDLE); }
            else if (saved) sendRecording();
            else { discard(); show(State.ERROR); }
        });
    }

    private static byte[] wavHeader(int bytes) {
        return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
            .put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(bytes + 36)
            .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1)
            .putInt(16_000).putInt(32_000).putShort((short) 2).putShort((short) 16)
            .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(bytes).array();
    }

    private void stopRecording(boolean cancel) {
        Capture current = capture;
        if (current == null) return;
        current.cancel |= cancel;
        current.stop = true;
        try { current.audio.stop(); } catch (RuntimeException ignored) {}
        ConduitMediaVolume.restoreSafely(this, volumeOwner);
        show(State.STOPPING);
    }

    private void discard() {
        recording.delete();
        prefs().edit().remove("recordingComplete").remove("recordingOrigin").remove("recordingTokenOrigin").remove("recordingRetried").remove("recordingId").apply();
    }

    private void cancel() {
        if (capture != null) { stopRecording(true); return; }
        generation++;
        HttpURLConnection connection = uploading;
        if (connection != null) workerDisconnect(connection);
        discard();
        ConduitMediaVolume.restoreSafely(this, volumeOwner);
        show(State.HANDLE);
    }

    private void workerDisconnect(HttpURLConnection connection) {
        new Thread(connection::disconnect, "float-cancel").start();
    }

    private void sendRecording() {
        if (!prefs().getBoolean("recordingComplete", false) || recording.length() <= 44) { openApp(false); return; }
        ConduitMediaVolume.restoreSafely(this, volumeOwner);
        show(State.SENDING);
        int sending = ++generation;
        String origin = prefs().getString("recordingOrigin", "");
        String tokenOrigin = prefs().getString("recordingTokenOrigin", origin);
        String recordingId = prefs().getString("recordingId", "");
        // CookieManager's own cookie for this exact origin, never logged or sent across a redirect.
        String cookie = CookieManager.getInstance().getCookie(origin);
        worker.execute(() -> {
            boolean success = false;
            HttpURLConnection connection = null;
            try {
                if (destroyed || sending != generation) return;
                connection = (HttpURLConnection) new URL(origin + "/v0/agent/voice-message").openConnection();
                uploading = connection;
                if (connection instanceof javax.net.ssl.HttpsURLConnection)
                    ConduitWebViewClient.trustPaired((javax.net.ssl.HttpsURLConnection) connection);
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(610_000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "audio/wav");
                if (!recordingId.isEmpty()) connection.setRequestProperty("X-Conduit-Voice-Id", recordingId);
                boolean hasCookie = cookie != null && !cookie.isEmpty();
                if (hasCookie) connection.setRequestProperty("Cookie", cookie);
                String token = null;
                try { token = nativeToken(tokenOrigin); }
                catch (Exception error) { if (!hasCookie) throw error; }
                // A stale cookie from an older shell must not hide the installed client's current session.
                if (token != null) {
                    connection.setRequestProperty("Origin", "https://localhost");
                    connection.setRequestProperty("Authorization", "Bearer " + token);
                } else if (!hasCookie) throw new IllegalStateException("Open Conduit to sign in");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(recording.length());
                if (destroyed || sending != generation) return;
                try (FileInputStream in = new FileInputStream(recording); java.io.OutputStream out = connection.getOutputStream()) {
                    byte[] buffer = new byte[16 * 1024];
                    int count;
                    while ((count = in.read(buffer)) != -1) {
                        if (destroyed || sending != generation) return;
                        out.write(buffer, 0, count);
                    }
                }
                int status = connection.getResponseCode();
                success = status >= 200 && status < 300;
                if (!success) errorText = failureText(status, connection);
            } catch (Exception error) {
                // The retry retains the private WAV. No cookie, token, audio, or response body enters a log.
                errorText = "Couldn't reach Conduit";
            } finally {
                if (connection != null) connection.disconnect();
                uploading = null;
            }
            boolean sent = success;
            main.post(() -> {
                if (destroyed || sending != generation) return;
                if (sent) {
                    discard();
                    sentAt = SystemClock.uptimeMillis();
                    show(State.SENT);
                    main.postDelayed(() -> { if (!destroyed && sending == generation) show(State.HANDLE); }, 1000);
                } else show(State.ERROR);
            });
        });
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

    /** Read the existing secure-storage entry; do not duplicate a native session in plain preferences. */
    private String nativeToken(String origin) throws Exception {
        // Matches native-auth-client.ts and @aparajita/capacitor-secure-storage's Android AES/GCM format.
        String key = "capacitor-storage_conduit.native.bearer-token." + origin.replaceAll("[^a-zA-Z0-9.\\-]+", "-");
        String stored = getSharedPreferences("WSSecureStorageSharedPreferences", MODE_PRIVATE).getString(key, null);
        if (stored == null) return null;
        String[] parts = stored.split("\u0010");
        if (parts.length != 2) return null;
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry entry = store.getEntry(key, null);
        if (!(entry instanceof KeyStore.SecretKeyEntry)) return null;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, ((KeyStore.SecretKeyEntry) entry).getSecretKey(),
            new GCMParameterSpec(128, Base64.decode(parts[1], Base64.DEFAULT)));
        Object value = new JSONTokener(new String(cipher.doFinal(Base64.decode(parts[0], Base64.DEFAULT)), StandardCharsets.UTF_8)).nextValue();
        return value instanceof String && ((String) value).matches("[A-Za-z0-9_-]{32,256}") ? (String) value : null;
    }

    @Override public void onDestroy() {
        destroyed = true;
        if (active == this) active = null;
        if (snap != null) snap.cancel();
        if (morph != null) morph.cancel();
        if (Build.VERSION.SDK_INT >= 31 && blurListener != null) windows.removeCrossWindowBlurEnabledListener(blurListener);
        generation++;
        main.removeCallbacksAndMessages(null);
        if (capture != null) {
            capture.cancel = true;
            capture.stop = true;
            try { capture.audio.stop(); } catch (RuntimeException ignored) {}
        }
        HttpURLConnection connection = uploading;
        if (connection != null) workerDisconnect(connection);
        ConduitMediaVolume.restoreSafely(this, volumeOwner);
        // Preserve only a failed, completed recording while enabled. Turning off also discards the retry.
        if (!prefs().getBoolean("enabled", false)) discard();
        worker.shutdown();
        if (overlay != null) overlay.dismiss();
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /** One bounded overlay window, with separate accessible Cancel and Stop buttons. */
    private final class FloatView extends FrameLayout {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint text = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final Drawable mark = getDrawable(R.drawable.ic_stat_conduit).mutate();
        private final ImageButton cancelButton, stopButton;
        private float downX, downY;
        private int initialX, initialY;
        private boolean dragging, moved;
        /* The Aura, as the app's (components/ui/pill.tsx): a mesh of five coloured blobs behind the frost, each circling near
           its edge, every point their blend by distance with the hue held. Drawn small and scaled up; the level turns them
           faster, brightens them and moves their balance. It shows while recording and drains after. */
        private final float[][] blobs = { // from (deg), l, c, h, orbit (s a turn), swell
            { 180, .58f, .2f, 290, 7, .5f }, { 300, .64f, .21f, 22, -9, -.35f }, { 60, .64f, .23f, 345, 11, .6f },
            { 0, .74f, .17f, 62, -13, .45f }, { 125, .6f, .2f, 315, 8, -.3f } };
        private final float[] turns = { 0, 1.3f, 2.6f, 3.9f, 5.2f };
        private Bitmap aura;
        private int[] auraPixels;
        private float auraShown, auraLevel;
        private long auraLast;
        private final Paint auraPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Path clip = new Path();

        FloatView() {
            super(ConduitFloatService.this);
            setWillNotDraw(false);
            setClickable(true);
            // Conduit's dark tokens: foreground oklch(.93) ~ #e8e9eb, background oklch(.186) ~ #141518, tint white 7%.
            cancelButton = new ImageButton(getContext());
            cancelButton.setImageResource(R.drawable.float_cancel);
            cancelButton.setImageTintList(ColorStateList.valueOf(0xbfe8e9eb));
            cancelButton.setScaleType(ImageView.ScaleType.CENTER);
            cancelButton.setContentDescription("Cancel");
            cancelButton.setBackground(roundButton(0x12ffffff));
            cancelButton.setOnClickListener(view -> cancel());
            addView(cancelButton);
            // Send, as the phone composer's Stop and send: the primary button, light with a dark arrow.
            stopButton = new ImageButton(getContext());
            stopButton.setImageResource(R.drawable.float_send);
            stopButton.setImageTintList(ColorStateList.valueOf(0xff141518));
            stopButton.setScaleType(ImageView.ScaleType.CENTER);
            stopButton.setContentDescription("Send to jbot");
            stopButton.setBackground(roundButton(0xffe8e9eb));
            stopButton.setOnClickListener(view -> { if (state == State.RECORDING) stopRecording(false); });
            addView(stopButton);
        }

        private GradientDrawable roundButton(int fill) {
            GradientDrawable background = new GradientDrawable();
            background.setShape(GradientDrawable.OVAL);
            background.setColor(fill);
            return background;
        }

        void buttons() {
            // Sending and sent are the small bubble's own drawing; the buttons are the pill's.
            cancelButton.setVisibility(state == State.RECORDING || state == State.ERROR ? VISIBLE : GONE);
            stopButton.setVisibility(state == State.RECORDING ? VISIBLE : GONE);
            stopButton.setEnabled(state == State.RECORDING);
        }

        @Override protected void onMeasure(int width, int height) {
            int button = MeasureSpec.makeMeasureSpec(dp(36), MeasureSpec.EXACTLY);
            cancelButton.measure(button, button);
            stopButton.measure(button, button);
            setMeasuredDimension(frameWidth, frameHeight);
        }

        /** How far the content has faded in: it waits until the pill is mostly open, and leaves first on close. */
        private float contentAlpha() { return Math.max(0, Math.min(1, (openness - .45f) / .55f)); }

        @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
            // The content keeps its final place while the window grows out from the bubble's edge.
            int width = state == State.HANDLE ? dp(PILL) : controlWidth();
            int offset = prefs().getBoolean("right", true) ? getWidth() - width : 0;
            int y = (getHeight() - dp(36)) / 2;
            cancelButton.layout(offset + dp(4), y, offset + dp(40), y + dp(36));
            stopButton.layout(offset + width - dp(40), y, offset + width - dp(4), y + dp(36));
            for (View button : new View[] { cancelButton, stopButton }) button.setAlpha(contentAlpha());
        }

        private int gamma(double x) { return (int) Math.max(0, Math.min(255, 255 * (x <= .0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - .055))); }

        /** Steps the Aura on (dt seconds) and draws it into its small bitmap; false when it has nothing to show. */
        private boolean stepAura(float w, float h) {
            long now = SystemClock.uptimeMillis();
            float dt = auraLast == 0 ? 0 : Math.min(.1f, (now - auraLast) / 1000f);
            auraLast = now;
            float target = state == State.RECORDING ? 1 : 0;
            auraShown += Math.signum(target - auraShown) * Math.min(Math.abs(target - auraShown), dt / (target > 0 ? .35f : .5f));
            auraLevel += (level - auraLevel) * Math.min(1, dt / .12f);
            if (auraShown <= 0 && target == 0) { auraLast = 0; return false; }
            int gw = 64, gh = Math.max(4, Math.round(64 * h / Math.max(1, w)));
            if (aura == null || aura.getHeight() != gh) { aura = Bitmap.createBitmap(gw, gh, Bitmap.Config.ARGB_8888); auraPixels = new int[gw * gh]; }
            float lv = auraLevel, aspect = (float) gw / gh;
            int n = blobs.length;
            float[] bx = new float[n], by = new float[n], br = new float[n], bl = new float[n], bc = new float[n], ba = new float[n], bb = new float[n];
            for (int i = 0; i < n; i++) {
                float[] blob = blobs[i];
                turns[i] += dt * (2 * (float) Math.PI / blob[4]) * (1 + 1.5f * lv);
                double t = turns[i], from = Math.toRadians(blob[0]), reach = .38 * (.9 + lv * blob[5] + .25 * Math.sin(2 * t));
                bx[i] = (float) (.5 + .32 * Math.cos(from) + .14 * Math.cos(t));
                by[i] = (float) (.5 + .36 * Math.sin(from) + .26 * Math.sin(t));
                br[i] = (float) Math.pow(Math.max(.06, reach), 2);
                bl[i] = blob[1] + .05f * lv; bc[i] = blob[2];
                ba[i] = (float) Math.cos(Math.toRadians(blob[3])); bb[i] = (float) Math.sin(Math.toRadians(blob[3]));
            }
            // A faint ground of the middle hue everywhere, so two far hues meeting settle through it.
            float gw0 = .18f, ga = (float) Math.cos(Math.toRadians(345)), gb = (float) Math.sin(Math.toRadians(345));
            for (int y = 0; y < gh; y++) for (int x = 0; x < gw; x++) {
                float u = (x + .5f) / gw, v = (y + .5f) / gh;
                float sw = gw0, sl = gw0 * .62f, sc = gw0 * .2f, sa = gw0 * ga, sb = gw0 * gb;
                for (int i = 0; i < n; i++) {
                    float dx = (u - bx[i]) * Math.min(1, aspect), dy = (v - by[i]) * Math.min(1, 1 / aspect);
                    float k = (float) Math.exp(-(dx * dx + dy * dy) / br[i]);
                    sw += k; sl += k * bl[i]; sc += k * bc[i]; sa += k * ba[i]; sb += k * bb[i];
                }
                double norm = Math.hypot(sa, sb), c = sc / sw, L = sl / sw, A = c * sa / (norm == 0 ? 1 : norm), B = c * sb / (norm == 0 ? 1 : norm);
                double l_ = L + .3963377774 * A + .2158037573 * B, m_ = L - .1055613458 * A - .0638541728 * B, s_ = L - .0894841775 * A - 1.291485548 * B;
                double lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc3 = s_ * s_ * s_;
                auraPixels[y * gw + x] = 0xff000000 | gamma(4.0767416621 * lc - 3.3077115913 * mc + .2309699292 * sc3) << 16
                    | gamma(-1.2684380046 * lc + 2.6097574011 * mc - .3413193965 * sc3) << 8 | gamma(-.0041960863 * lc - .7034186147 * mc + 1.707614701 * sc3);
            }
            aura.setPixels(auraPixels, 0, gw, 0, 0, gw, gh);
            return true;
        }

        @Override protected void onDraw(Canvas canvas) {
            float w = getWidth(), h = getHeight();
            boolean right = prefs().getBoolean("right", true);
            // The Aura under everything, clipped to the pill, with the frost's sheen and lit rim over it.
            if (stepAura(w, h)) {
                float rr = Math.min(w, h) / 2;
                clip.reset();
                clip.addRoundRect(0, 0, w, h, rr, rr, Path.Direction.CW);
                canvas.save();
                canvas.clipPath(clip);
                auraPaint.setAlpha(Math.round(255 * auraShown * Math.min(1, openness)));
                canvas.drawBitmap(aura, null, new RectF(0, 0, w, h), auraPaint);
                int sheen = Math.round(26 * auraShown);
                paint.setShader(new android.graphics.LinearGradient(0, 0, 0, h * .6f, Color.argb(sheen, 255, 255, 255), 0, android.graphics.Shader.TileMode.CLAMP));
                canvas.drawRect(0, 0, w, h, paint);
                paint.setShader(null);
                // The inset glow (white 14%, reaching .3 of the pill's height), as stacked strokes fading inward.
                paint.setStyle(Paint.Style.STROKE);
                float reach = .3f * h;
                for (int i = 0; i < 6; i++) {
                    float d = reach * (i + .5f) / 6, sw = reach / 6;
                    paint.setStrokeWidth(sw);
                    paint.setColor(Color.argb(Math.round(36 * auraShown * (1 - (i + .5f) / 6)), 255, 255, 255));
                    canvas.drawRoundRect(d, d, w - d, h - d, Math.max(0, rr - d), Math.max(0, rr - d), paint);
                }
                paint.setStyle(Paint.Style.FILL);
                canvas.restore();
                postInvalidateOnAnimation();
            }
            // The frost (fill, its one stroke, the blur) is the window's background; this draws only what sits on it.
            // A soft top highlight, inside the stroke, as v2's inset 0 1px 0 white 50%.
            float r = Math.min(w, h) / 2, inset = dp(1);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(1));
            paint.setShader(new android.graphics.LinearGradient(0, inset, 0, h / 2, 0x59ffffff, 0x00ffffff, android.graphics.Shader.TileMode.CLAMP));
            canvas.drawRoundRect(inset + dp(.5f), inset + dp(.5f), w - inset - dp(.5f), h - inset - dp(.5f), r - inset, r - inset, paint);
            paint.setShader(null);
            paint.setStyle(Paint.Style.FILL);
            // At rest: the Conduit mark in the bubble's middle, fading as it opens.
            if (openness < 1) {
                mark.setAlpha(Math.round(235 * (1 - Math.min(1, openness / .45f))));
                float cx = right ? w - dp(HANDLE_W) / 2f : dp(HANDLE_W) / 2f;
                mark.setBounds(Math.round(cx - dp(7)), Math.round(h / 2 - dp(7)), Math.round(cx + dp(7)), Math.round(h / 2 + dp(7)));
                mark.draw(canvas);
            }
            if (state == State.HANDLE) return;
            int width = controlWidth();
            float offset = right ? w - width : 0;
            int alpha = Math.round(255 * contentAlpha());
            // The middle: between cancel (ends at 40) and send (starts at width - 40), with 6dp clear on each side.
            float from = offset + dp(46), to = offset + width - dp(46), mid = (from + to) / 2;
            if (state == State.RECORDING) {
                paint.setColor(Color.argb(alpha, 232, 233, 235));
                int bars = 7;
                float bar = dp(3), gap = dp(4), span = bars * bar + (bars - 1) * gap, x = mid - span / 2;
                for (int i = 0; i < bars; i++) {
                    float weight = 1 - Math.abs(i - (bars - 1) / 2f) / ((bars + 1) / 2f);
                    // Each bar breathes on its own beat, so even steady speech moves the row.
                    float wobble = .7f + .3f * (float) Math.sin(SystemClock.uptimeMillis() / 1000f * (7 + 2.3f * i) + i * 1.7f);
                    float tall = Math.min(h - dp(14), dp(4) + dp(26) * auraLevel * (.4f + .6f * weight) * wobble);
                    canvas.drawRoundRect(x, (h - tall) / 2, x + bar, (h + tall) / 2, bar / 2, bar / 2, paint);
                    x += bar + gap;
                }
            } else if (state == State.STOPPING || state == State.SENDING) {
                // The small bubble: a light spinner in its middle.
                paint.setColor(Color.argb(Math.round(alpha * .9f), 232, 233, 235));
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(dp(2));
                paint.setStrokeCap(Paint.Cap.ROUND);
                float cx = offset + width / 2f;
                canvas.drawArc(cx - dp(8), h / 2 - dp(8), cx + dp(8), h / 2 + dp(8), (SystemClock.uptimeMillis() % 900) * .4f, 250, false, paint);
                paint.setStrokeCap(Paint.Cap.BUTT);
                paint.setStyle(Paint.Style.FILL);
                postInvalidateOnAnimation();
            } else if (state == State.SENT) {
                // The tick draws itself on (220ms, decelerating), then holds until Float goes back to rest.
                float t = Math.min(1, (SystemClock.uptimeMillis() - sentAt) / 220f), drawn = 1 - (1 - t) * (1 - t) * (1 - t);
                float cx = offset + width / 2f, cy = h / 2;
                Path tick = new Path();
                tick.moveTo(cx - dp(6), cy + dp(.5f));
                tick.lineTo(cx - dp(1.75f), cy + dp(4.5f));
                tick.lineTo(cx + dp(6.5f), cy - dp(4.5f));
                android.graphics.PathMeasure measure = new android.graphics.PathMeasure(tick, false);
                Path part = new Path();
                measure.getSegment(0, measure.getLength() * drawn, part, true);
                paint.setColor(Color.argb(alpha, 232, 233, 235));
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(dp(2.25f));
                paint.setStrokeCap(Paint.Cap.ROUND);
                paint.setStrokeJoin(Paint.Join.ROUND);
                canvas.drawPath(part, paint);
                paint.setStrokeCap(Paint.Cap.BUTT);
                paint.setStrokeJoin(Paint.Join.MITER);
                paint.setStyle(Paint.Style.FILL);
                if (t < 1) postInvalidateOnAnimation();
            } else if (state == State.ERROR) {
                text.setTextSize(dp(13));
                text.setColor(Color.argb(alpha, 232, 233, 235));
                CharSequence message = TextUtils.ellipsize(errorText, text, Math.max(0, width - dp(4 + 36 + 10 + 12)), TextUtils.TruncateAt.END);
                canvas.drawText(message.toString(), offset + dp(50), h / 2 - (text.ascent() + text.descent()) / 2, text);
            }
        }

        @Override public void onInitializeAccessibilityNodeInfo(android.view.accessibility.AccessibilityNodeInfo info) {
            super.onInitializeAccessibilityNodeInfo(info);
            if (state != State.HANDLE) info.addAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_DISMISS);
        }
        @Override public boolean performAccessibilityAction(int action, android.os.Bundle arguments) {
            if (action == android.view.accessibility.AccessibilityNodeInfo.ACTION_DISMISS) { cancel(); return true; }
            return super.performAccessibilityAction(action, arguments);
        }
        @Override public boolean performClick() {
            super.performClick();
            if (state == State.HANDLE) beginRecording();
            else if (state == State.ERROR) {
                if (!prefs().getBoolean("recordingRetried", false) && prefs().getBoolean("recordingComplete", false)) {
                    prefs().edit().putBoolean("recordingRetried", true).apply();
                    sendRecording();
                } else openApp(false);
            }
            return true;
        }

        private void snapToEdge() {
            boolean right = position.x + getWidth() / 2f > availableWidth / 2f;
            prefs().edit().putBoolean("right", right)
                .putFloat("y", position.y / (float) Math.max(1, availableHeight - controlHeight())).apply();
            if (right) position.x = Math.max(0, availableWidth - getWidth() - position.x);
            position.gravity = Gravity.TOP | (right ? Gravity.RIGHT : Gravity.LEFT);
            updateFrost();
            snap = ValueAnimator.ofInt(position.x, dp(EDGE));
            snap.setDuration(180);
            snap.setInterpolator(new DecelerateInterpolator());
            snap.addUpdateListener(animation -> {
                position.x = (int) animation.getAnimatedValue();
                overlayWindow.setAttributes(position);
            });
            snap.start();
        }

        @Override public boolean onInterceptTouchEvent(MotionEvent event) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                if (snap != null) { snap.cancel(); snap = null; }
                downX = event.getRawX(); downY = event.getRawY(); initialY = position.y;
                initialX = (position.gravity & Gravity.HORIZONTAL_GRAVITY_MASK) == Gravity.RIGHT
                    ? availableWidth - getWidth() - position.x : position.x;
                dragging = false; moved = false;
            } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                float distance = (float) Math.hypot(event.getRawX() - downX, event.getRawY() - downY);
                if (distance > ViewConfiguration.get(getContext()).getScaledTouchSlop()) moved = true;
                if (moved && state == State.HANDLE) dragging = true;
                if (dragging || distance > dp(60)) return true;
            }
            return super.onInterceptTouchEvent(event);
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: return true;
                case MotionEvent.ACTION_MOVE:
                    float distance = (float) Math.hypot(event.getRawX() - downX, event.getRawY() - downY);
                    if (distance > ViewConfiguration.get(getContext()).getScaledTouchSlop()) {
                        moved = true;
                        if (state == State.HANDLE) dragging = true;
                    }
                    if (dragging) {
                        position.x = Math.max(0, Math.min(availableWidth - getWidth(), initialX + Math.round(event.getRawX() - downX)));
                        position.y = Math.max(0, Math.min(availableHeight - getHeight(), initialY + Math.round(event.getRawY() - downY)));
                        position.gravity = Gravity.TOP | Gravity.LEFT;
                        overlayWindow.setAttributes(position);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (dragging) snapToEdge();
                    else if (state != State.HANDLE && Math.hypot(event.getRawX() - downX, event.getRawY() - downY) > dp(60)) cancel();
                    else if (!moved) performClick();
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    if (dragging) snapToEdge();
                    dragging = false;
                    return true;
                default: return true;
            }
        }
    }
}
