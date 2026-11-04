package com.jaskaran.conduit;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.HashMap;
import java.util.Map;

/** One saved media volume and ramp, shared by WebView dictation and Float. */
final class ConduitMediaVolume {
    private static final Map<String, Integer> levels = new HashMap<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Runnable ramp;
    private static boolean userAdjusted;

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("conduit-audio", Context.MODE_PRIVATE);
    }

    private static void cancelRamp() {
        if (ramp != null) main.removeCallbacks(ramp);
        ramp = null;
    }

    static synchronized void recover(Context context) {
        // Live ramps belong to this process. Only a saved marker without one is recovery.
        if (levels.isEmpty() && ramp == null) restoreSaved(context);
    }

    static synchronized void lower(Context context, String owner, int level) {
        Integer previous = levels.put(owner, level);
        try { apply(context); }
        catch (RuntimeException error) {
            if (previous == null) levels.remove(owner);
            else levels.put(owner, previous);
            try {
                if (levels.isEmpty()) restoreSaved(context);
                else apply(context);
            } catch (RuntimeException recovery) { error.addSuppressed(recovery); }
            throw error;
        }
    }

    static synchronized void restore(Context context, String owner) {
        if (levels.remove(owner) == null) return;
        apply(context);
        if (levels.isEmpty()) userAdjusted = false;
    }

    private static void apply(Context context) {
        cancelRamp();
        if (userAdjusted) return;
        Context app = context.getApplicationContext();
        AudioManager audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) throw new IllegalStateException("Media volume is unavailable");
        SharedPreferences prefs = preferences(app);
        int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        if (prefs.contains("original") && current != prefs.getInt("applied", -1)) {
            userAdjusted = !levels.isEmpty();
            prefs.edit().clear().commit();
            return;
        }
        if (levels.isEmpty() && !prefs.contains("original")) return;
        int original = prefs.getInt("original", current);
        int level = 100;
        for (int requested : levels.values()) level = Math.min(level, requested);
        int target = levels.isEmpty() ? original : Math.min(original,
            level == 0 ? 0 : Math.max(1, Math.round(original * level / 100f)));
        if (!prefs.edit().putInt("original", original).putInt("applied", current).commit()) {
            throw new IllegalStateException("Could not save media volume");
        }
        if (target == current) {
            if (levels.isEmpty()) prefs.edit().clear().commit();
            return;
        }
        int duration = target < current ? 400 : 300;
        int distance = Math.abs(target - current);
        int interval = Math.max(1, Math.min(25, duration / distance));
        long started = SystemClock.uptimeMillis();
        ramp = new Runnable() {
            @Override public void run() {
                synchronized (ConduitMediaVolume.class) {
                    if (ramp != this) return;
                    try {
                        int now = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
                        // Compare with the last index actually set, never the ramp's final target.
                        if (now != prefs.getInt("applied", -1)) {
                            userAdjusted = !levels.isEmpty();
                            prefs.edit().clear().commit();
                            ramp = null;
                            return;
                        }
                        float progress = Math.min(1, (SystemClock.uptimeMillis() - started) / (float) duration);
                        int next = current + Math.round((target - current) * progress);
                        if (next != now) {
                            audio.setStreamVolume(AudioManager.STREAM_MUSIC, next, 0);
                            if (!prefs.edit().putInt("applied", audio.getStreamVolume(AudioManager.STREAM_MUSIC)).commit()) {
                                throw new IllegalStateException("Could not save media volume");
                            }
                        }
                        if (progress < 1) main.postDelayed(this, interval);
                        else {
                            ramp = null;
                            if (levels.isEmpty()) prefs.edit().clear().commit();
                        }
                    } catch (RuntimeException error) {
                        ramp = null; // Keep the saved marker for a later restore or process recovery.
                        android.util.Log.w("ConduitAudio", "Could not change media volume", error);
                    }
                }
            }
        };
        main.post(ramp);
    }

    private static void restoreSaved(Context context) {
        cancelRamp();
        SharedPreferences prefs = preferences(context);
        if (!prefs.contains("original")) return;
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        if (current == prefs.getInt("applied", -1)) {
            // Process-death recovery is immediate; there is no live recording to ease out of.
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, prefs.getInt("original", current), 0);
        }
        prefs.edit().clear().commit();
    }

    static void restoreSafely(Context context, String owner) {
        try { restore(context, owner); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
    }
}
