package com.jaskaran.conduit;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;

final class FloatRecorder {
    interface Listener {
        void onStarted(Capture capture);
        void onLevel(Capture capture, float level);
        void onComplete(Capture capture, boolean saved);
        void onFailure();
    }
    private static final int MAX_PCM_BYTES = 16_000 * 2 * 300;
    private final String volumeOwner = "float:" + java.util.UUID.randomUUID();
    private final Context context;
    private final File recording;
    private final Handler main;
    private final ExecutorService worker;
    private final Listener listener;

    FloatRecorder(Context context, File recording, Handler main, ExecutorService worker, Listener listener) {
        this.context = context;
        this.recording = recording;
        this.main = main;
        this.worker = worker;
        this.listener = listener;
    }

    private SharedPreferences prefs() { return ConduitFloatPlugin.preferences(context); }
    void restoreVolume() { ConduitMediaVolume.restoreSafely(context, volumeOwner); }

    void applyVolume() {
        String mode = prefs().getString("otherAudio", "keep");
        if ("keep".equals(mode)) ConduitMediaVolume.restore(context, volumeOwner);
        else ConduitMediaVolume.lower(context, volumeOwner, "mute".equals(mode) ? 0 : prefs().getInt("otherAudioLevel", 30));
    }

    static final class Capture {
        final AudioRecord audio;
        final int generation;
        ConduitFloatLive live;
        volatile boolean stop, cancel;
        Capture(AudioRecord audio, int generation) { this.audio = audio; this.generation = generation; }
    }

    void begin(int generation) {
        AudioRecord audio = null;
        try {
            int bufferSize = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (bufferSize <= 0) throw new IllegalStateException("Microphone is unavailable");
            // MIC, as the app's own dictation records: VOICE_RECOGNITION moved a Bluetooth headset to its call profile and
            // dropped music to call quality.
            audio = new AudioRecord(MediaRecorder.AudioSource.MIC, 16_000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(bufferSize, 6400));
            if (audio.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Microphone is unavailable");
            AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            for (AudioDeviceInfo input : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                if (input.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                    if (!audio.setPreferredDevice(input)) throw new IllegalStateException("Phone microphone is unavailable");
                    break;
                }
            }
            applyVolume();
            audio.startRecording();
            if (audio.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Microphone did not start");
            Capture next = new Capture(audio, generation);
            listener.onStarted(next);
            worker.execute(() -> record(next));
        } catch (Exception error) {
            if (audio != null) audio.release();
            restoreVolume();
            listener.onFailure();
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
                try { if (current.live != null) current.live.audio(buffer, count); }
                catch (RuntimeException ignored) { /* Never interrupt the WAV. */ }
                bytes += count;
                double sum = 0;
                for (int i = 0; i + 1 < count; i += 2) {
                    short sample = (short) ((buffer[i] & 255) | (buffer[i + 1] << 8));
                    sum += (double) sample * sample;
                }
                // Loudness on a dB scale, as hearing goes: -54 dBFS (a quiet room) is still, -18 (close speech) is full.
                double db = 20 * Math.log10(Math.max(1e-6, Math.sqrt(sum / Math.max(1, count / 2)) / 32768));
                float loud = (float) Math.max(0, Math.min(1, (db + 54) / 36));
                main.post(() -> listener.onLevel(current, loud));
            }
            if (!current.cancel && bytes > 0) {
                file.seek(0);
                file.write(wavHeader(bytes));
                complete = true;
            }
        } catch (Exception error) {
            // Keep credentials and provider replies out of the log.
        } finally {
            if (current.live != null) {
                if (current.cancel) current.live.close();
                else current.live.stop();
            }
            try { current.audio.stop(); } catch (RuntimeException ignored) {}
            current.audio.release();
            restoreVolume();
        }
        boolean saved = complete;
        // Complete is committed before any upload; incomplete recordings are never retried after process death.
        prefs().edit().putBoolean("recordingComplete", saved && !current.cancel).commit();
        main.post(() -> listener.onComplete(current, saved));
    }

    private static byte[] wavHeader(int bytes) {
        return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
            .put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(bytes + 36)
            .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1)
            .putInt(16_000).putInt(32_000).putShort((short) 2).putShort((short) 16)
            .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(bytes).array();
    }

    void stop(Capture current, boolean cancel) {
        if (current == null) return;
        if (current.live != null) {
            if (cancel) current.live.close();
            else current.live.stop();
        }
        current.cancel |= cancel;
        current.stop = true;
        try { current.audio.stop(); } catch (RuntimeException ignored) {}
        restoreVolume();
    }

    void destroy(Capture capture) {
        if (capture == null) return;
        capture.cancel = true;
        capture.stop = true;
        try { capture.audio.stop(); } catch (RuntimeException ignored) {}
    }
}
