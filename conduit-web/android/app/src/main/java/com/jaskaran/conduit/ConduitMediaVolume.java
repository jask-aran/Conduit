package com.jaskaran.conduit;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import java.util.HashMap;
import java.util.Map;

/** One saved media volume, shared by WebView dictation and the voice bubble. */
final class ConduitMediaVolume {
    private static final Map<String, Integer> levels = new HashMap<>();

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("conduit-audio", Context.MODE_PRIVATE);
    }

    static synchronized void recover(Context context) {
        if (levels.isEmpty()) restoreSaved(context);
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
        levels.remove(owner);
        if (levels.isEmpty()) restoreSaved(context);
        else apply(context);
    }

    private static void apply(Context context) {
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) throw new IllegalStateException("Media volume is unavailable");
        SharedPreferences prefs = preferences(context);
        int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        int original = prefs.getInt("original", current);
        int level = 100;
        for (int requested : levels.values()) level = Math.min(level, requested);
        int target = level == 0 ? 0 : Math.max(1, Math.round(original * level / 100f));
        if (!prefs.edit().putInt("original", original).putInt("applied", target).commit()) {
            throw new IllegalStateException("Could not save media volume");
        }
        try { audio.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0); }
        catch (RuntimeException error) {
            // A failed change can leave the previous lowered level in place. Retain its recovery marker.
            prefs.edit().putInt("applied", audio.getStreamVolume(AudioManager.STREAM_MUSIC)).commit();
            throw error;
        }
        prefs.edit().putInt("applied", audio.getStreamVolume(AudioManager.STREAM_MUSIC)).commit();
    }

    private static void restoreSaved(Context context) {
        SharedPreferences prefs = preferences(context);
        if (!prefs.contains("original")) return;
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;
        int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        if (current == prefs.getInt("applied", -1)) {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, prefs.getInt("original", current), 0);
        }
        prefs.edit().clear().commit();
    }

    static void restoreSafely(Context context, String owner) {
        try { restore(context, owner); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
    }
}
