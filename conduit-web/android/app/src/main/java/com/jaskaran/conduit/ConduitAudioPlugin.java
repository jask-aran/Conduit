package com.jaskaran.conduit;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ConduitAudio")
public class ConduitAudioPlugin extends Plugin {
    private AudioManager audio;
    private SharedPreferences preferences;

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        preferences = getContext().getSharedPreferences("conduit-audio", Context.MODE_PRIVATE);
        restoreSafely();
    }

    private void restoreSafely() {
        try {
            restoreVolume();
        } catch (Exception error) {
            android.util.Log.w("ConduitAudio", "Could not restore media volume", error);
        }
    }

    private synchronized void restoreVolume() {
        if (audio == null || preferences == null || !preferences.contains("original")) return;
        int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        if (current == preferences.getInt("applied", -1)) {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, preferences.getInt("original", current), 0);
        }
        preferences.edit().clear().commit();
    }

    private synchronized void setVolume(PluginCall call, int level) {
        try {
            if (audio == null) throw new IllegalStateException("Media volume is unavailable");
            // A repeated start must not lower an already lowered volume again.
            if (preferences.contains("original")) {
                call.resolve();
                return;
            }
            int current = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
            int target = level == 0 ? 0 : Math.max(1, Math.round(current * level / 100f));
            // Commit before changing the volume so a killed app can recover it.
            if (!preferences.edit().putInt("original", current).putInt("applied", target).commit()) {
                throw new IllegalStateException("Could not save media volume");
            }
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
            preferences.edit().putInt("applied", audio.getStreamVolume(AudioManager.STREAM_MUSIC)).commit();
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not change media volume", error);
        }
    }

    @PluginMethod
    public void lower(PluginCall call) {
        setVolume(call, Math.max(5, Math.min(80, call.getInt("level", 30))));
    }

    @PluginMethod
    public void mute(PluginCall call) {
        setVolume(call, 0);
    }

    @PluginMethod
    public void restore(PluginCall call) {
        try {
            restoreVolume();
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not restore media volume", error);
        }
    }

    @Override
    protected void handleOnPause() {
        restoreSafely();
    }

    @Override
    protected void handleOnDestroy() {
        restoreSafely();
    }
}
