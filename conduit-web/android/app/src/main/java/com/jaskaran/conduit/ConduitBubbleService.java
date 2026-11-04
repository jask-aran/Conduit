package com.jaskaran.conduit;

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
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
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

public class ConduitBubbleService extends Service {
    static final String VISIBLE = "conduit.bubble.VISIBLE";
    static final String RESTORE = "conduit.bubble.RESTORE";
    private static final String OFF = "conduit.bubble.OFF";
    private static final int NOTIFICATION = 4103;
    private static final int MAX_PCM_BYTES = 16_000 * 2 * 300;
    private enum State { HANDLE, RECORDING, STOPPING, SENDING, ERROR, SENT }
    private final String volumeOwner = "bubble:" + java.util.UUID.randomUUID();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private WindowManager windows;
    private WindowManager.LayoutParams position;
    private BubbleView bubble;
    private State state = State.HANDLE;
    private Capture capture;
    private File recording;
    private volatile HttpURLConnection uploading;
    private boolean microphoneReady;
    private volatile boolean destroyed;
    private volatile int generation;
    private float level;

    private SharedPreferences prefs() { return ConduitBubblePlugin.preferences(this); }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override public void onCreate() {
        super.onCreate();
        try { ConduitMediaVolume.recover(this); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
        windows = (WindowManager) getSystemService(WINDOW_SERVICE);
        recording = new File(getCacheDir(), "jbot-bubble.wav");
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
            || !ConduitBubblePlugin.microphoneGranted(this)) {
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
            if (bubble == null) {
                bubble = new BubbleView();
                position = new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                    PixelFormat.TRANSLUCENT);
                place();
                windows.addView(bubble, position);
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
            NotificationChannel channel = new NotificationChannel("jbot_bubble", "jbot bubble", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent off = PendingIntent.getService(this, 1, new Intent(this, ConduitBubbleService.class).setAction(OFF), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, "jbot_bubble").setSmallIcon(R.drawable.ic_stat_conduit)
            .setContentTitle("jbot bubble").setContentIntent(open).setOngoing(true).setSilent(true)
            .addAction(0, "Turn off", off).build();
    }

    private void place() {
        position.gravity = Gravity.TOP | (prefs().getBoolean("right", true) ? Gravity.RIGHT : Gravity.LEFT);
        position.x = 0;
        int height = getResources().getDisplayMetrics().heightPixels;
        position.y = Math.round(Math.max(0, height - dp(100)) * prefs().getFloat("y", .45f));
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (bubble != null) { place(); windows.updateViewLayout(bubble, position); }
    }

    private void show(State next) {
        if (destroyed) return;
        state = next;
        level = 0;
        bubble.setContentDescription(next == State.HANDLE ? "Talk to jbot. Long press to move."
            : next == State.RECORDING ? "Recording. Stop or cancel." : next == State.ERROR ? "Couldn't send. Tap to retry or open Conduit."
            : next == State.SENT ? "Sent to jbot" : "Sending to jbot");
        bubble.requestLayout();
        bubble.invalidate();
    }

    private void openApp(boolean record) {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("conduit.bubble.record", record));
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
            audio = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16_000,
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
            show(State.ERROR);
        }
    }

    private void record(Capture current) {
        boolean complete = false;
        try (RandomAccessFile file = new RandomAccessFile(recording, "rw")) {
            file.setLength(0);
            file.write(new byte[44]);
            byte[] buffer = new byte[3200];
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
                float rms = (float) Math.min(1, Math.sqrt(sum / (count / 2)) / 6000);
                main.post(() -> { if (capture == current && state == State.RECORDING) { level = rms; bubble.invalidate(); } });
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
        new Thread(connection::disconnect, "jbot-bubble-cancel").start();
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
            } catch (Exception error) {
                // The retry retains the private WAV. No cookie, token, audio, or response body enters a log.
            } finally {
                if (connection != null) connection.disconnect();
                uploading = null;
            }
            boolean sent = success;
            main.post(() -> {
                if (destroyed || sending != generation) return;
                if (sent) {
                    discard();
                    show(State.SENT);
                    main.postDelayed(() -> { if (!destroyed && sending == generation) show(State.HANDLE); }, 1600);
                } else show(State.ERROR);
            });
        });
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
        if (bubble != null && bubble.isAttachedToWindow()) windows.removeView(bubble);
        stopForeground(true);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /** A single tightly bounded native window; everything outside it remains touchable. */
    private final class BubbleView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float downX, downY;
        private int initialY;
        private boolean dragging, moved;
        private final Runnable longPress = () -> { if (!moved && state == State.HANDLE) { dragging = true; performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS); } };
        BubbleView() {
            super(ConduitBubbleService.this);
            setClickable(true);
            setContentDescription("Talk to jbot. Long press to move.");
            setElevation(dp(6));
        }
        @Override protected void onMeasure(int width, int height) {
            int available = getResources().getDisplayMetrics().widthPixels - dp(8);
            setMeasuredDimension(state == State.HANDLE ? dp(24) : Math.min(available, dp(state == State.ERROR ? 304 : 232)), dp(state == State.HANDLE ? 64 : 56));
        }
        @Override protected void onDraw(Canvas canvas) {
            float w = getWidth(), h = getHeight();
            paint.setColor(Color.rgb(20, 20, 22));
            canvas.drawRoundRect(0, 0, w, h, dp(28), dp(28), paint);
            paint.setColor(Color.rgb(214, 214, 219));
            if (state == State.HANDLE) {
                canvas.drawRoundRect(dp(10), dp(21), dp(14), dp(43), dp(2), dp(2), paint);
                return;
            }
            // Person glyph, live level dots, stop, cancel. All controls stay in this window.
            canvas.drawCircle(dp(26), dp(21), dp(4), paint);
            paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(2));
            canvas.drawArc(dp(19), dp(28), dp(33), dp(39), 190, 160, false, paint);
            paint.setStyle(Paint.Style.FILL);
            if (state == State.RECORDING) {
                for (int i = 0; i < 7; i++) {
                    float wave = 1 - Math.abs(i - 3) / 4f;
                    canvas.drawCircle(dp(54 + i * 13), h / 2, dp(2 + level * wave * 4), paint);
                }
                paint.setColor(Color.rgb(221, 66, 71));
                canvas.drawCircle(w - dp(56), h / 2, dp(17), paint);
                paint.setColor(Color.WHITE);
                canvas.drawRoundRect(w - dp(61), h / 2 - dp(5), w - dp(51), h / 2 + dp(5), dp(1), dp(1), paint);
            } else {
                paint.setTextSize(dp(12));
                canvas.drawText(state == State.SENT ? "Sent to jbot" : state == State.ERROR ? "Couldn't send — open Conduit" : "Sending…", dp(43), h / 2 + dp(4), paint);
            }
            paint.setColor(Color.rgb(180, 180, 185));
            paint.setStrokeWidth(dp(1.5f));
            canvas.drawLine(w - dp(24), h / 2 - dp(4), w - dp(16), h / 2 + dp(4), paint);
            canvas.drawLine(w - dp(24), h / 2 + dp(4), w - dp(16), h / 2 - dp(4), paint);
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
            else if (state == State.RECORDING) stopRecording(false);
            else if (state == State.ERROR) {
                if (!prefs().getBoolean("recordingRetried", false) && prefs().getBoolean("recordingComplete", false)) {
                    prefs().edit().putBoolean("recordingRetried", true).apply();
                    sendRecording();
                }
                else openApp(false);
            }
            return true;
        }
        @Override public boolean onTouchEvent(MotionEvent event) {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getRawX(); downY = event.getRawY(); initialY = position.y;
                    dragging = false; moved = false;
                    if (state == State.HANDLE) main.postDelayed(longPress, ViewConfiguration.getLongPressTimeout());
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (Math.hypot(event.getRawX() - downX, event.getRawY() - downY) > ViewConfiguration.get(getContext()).getScaledTouchSlop()) {
                        moved = true;
                        main.removeCallbacks(longPress);
                    }
                    if (dragging) {
                        int height = getResources().getDisplayMetrics().heightPixels;
                        position.y = Math.max(0, Math.min(height - getHeight(), initialY + Math.round(event.getRawY() - downY)));
                        boolean right = event.getRawX() > getResources().getDisplayMetrics().widthPixels / 2f;
                        position.gravity = Gravity.TOP | (right ? Gravity.RIGHT : Gravity.LEFT);
                        windows.updateViewLayout(this, position);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    main.removeCallbacks(longPress);
                    if (dragging) {
                        prefs().edit().putBoolean("right", (position.gravity & Gravity.RIGHT) == Gravity.RIGHT)
                            .putFloat("y", Math.min(1, position.y / (float) Math.max(1, getResources().getDisplayMetrics().heightPixels - dp(100)))).apply();
                    } else if (state != State.HANDLE && Math.hypot(event.getRawX() - downX, event.getRawY() - downY) > dp(60)) cancel();
                    else if (!moved) {
                        if (state != State.HANDLE && event.getX() > getWidth() - dp(40)) cancel();
                        else if (state != State.RECORDING || event.getX() > getWidth() - dp(80)) performClick();
                    }
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    main.removeCallbacks(longPress);
                    return true;
                default: return true;
            }
        }
    }
}
