package com.jaskaran.conduit;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ConduitAudio")
public class ConduitAudioPlugin extends Plugin {
    @Override
    public void load() {
        try { ConduitMediaVolume.recover(getContext()); }
        catch (RuntimeException error) { android.util.Log.w("ConduitAudio", "Could not restore media volume", error); }
    }

    private void restoreSafely() {
        ConduitMediaVolume.restoreSafely(getContext(), "dictation");
    }

    private void setVolume(PluginCall call, int level) {
        try {
            ConduitMediaVolume.lower(getContext(), "dictation", level);
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
            ConduitMediaVolume.restore(getContext(), "dictation");
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
