package com.jaskaran.conduit;

import android.content.Context;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.HapticFeedbackConstants;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * Plays the app's haptic effects (components/ui/haptics.ts, from the --haptic-* tokens) as the platform's own clear
 * haptics, never a timed buzz. An effect is a list of primitives, each with a scale (0-1) and a delay (ms):
 * composed from VibrationEffect.Composition where the actuator has them all (Android 11+, the rich ones), else the
 * nearest predefined effect (tick, click or heavy click, Android 10+), else the view's own haptic feedback. Touch
 * usage, so the system's touch-feedback switch silences them.
 */
@CapacitorPlugin(name = "ConduitHaptics")
public class ConduitHapticsPlugin extends Plugin {
    private Vibrator vibrator;

    @Override public void load() {
        Context context = getContext();
        vibrator = Build.VERSION.SDK_INT >= 31
            ? ((VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator()
            : (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    private static int primitive(String name) {
        switch (name) {
            case "click": return VibrationEffect.Composition.PRIMITIVE_CLICK;
            case "thud": return VibrationEffect.Composition.PRIMITIVE_THUD;
            case "spin": return VibrationEffect.Composition.PRIMITIVE_SPIN;
            case "quick-rise": return VibrationEffect.Composition.PRIMITIVE_QUICK_RISE;
            case "slow-rise": return VibrationEffect.Composition.PRIMITIVE_SLOW_RISE;
            case "quick-fall": return VibrationEffect.Composition.PRIMITIVE_QUICK_FALL;
            case "low-tick": return Build.VERSION.SDK_INT >= 31 ? VibrationEffect.Composition.PRIMITIVE_LOW_TICK : VibrationEffect.Composition.PRIMITIVE_TICK;
            default: return VibrationEffect.Composition.PRIMITIVE_TICK;
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        try { play(vibrator, call.getArray("steps", new JSArray()), call.getString("weight", "tick"), getBridge().getWebView()); }
        catch (Exception ignored) {}
        call.resolve();
    }

    /** Plays an effect's steps (as haptics.ts sends them, already at the person's strength); native pieces (the
     *  camera's shutter) play the ones their page handed them. */
    static void play(Context context, org.json.JSONArray steps, String weight, android.view.View view) {
        Vibrator vibrator = Build.VERSION.SDK_INT >= 31
            ? ((VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator()
            : (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        try { play(vibrator, steps, weight, view); } catch (Exception ignored) {}
    }

    private static void play(Vibrator vibrator, org.json.JSONArray steps, String weight, android.view.View view) throws Exception {
        if (vibrator == null || !vibrator.hasVibrator() || steps == null || steps.length() == 0) return;
        VibrationEffect effect = null;
        if (Build.VERSION.SDK_INT >= 30) {
            int[] ids = new int[steps.length()];
            for (int i = 0; i < ids.length; i++) ids[i] = primitive(steps.getJSONObject(i).optString("primitive"));
            if (vibrator.areAllPrimitivesSupported(ids)) {
                VibrationEffect.Composition composition = VibrationEffect.startComposition();
                for (int i = 0; i < ids.length; i++) {
                    JSONObject step = steps.getJSONObject(i);
                    float scale = (float) Math.max(0, Math.min(1, step.optDouble("scale", 1)));
                    if (scale > 0) composition.addPrimitive(ids[i], scale, Math.max(0, step.optInt("delay", 0)));
                }
                effect = composition.compose();
            }
        }
        if (effect == null && Build.VERSION.SDK_INT >= 29) effect = VibrationEffect.createPredefined(
            "heavy".equals(weight) ? VibrationEffect.EFFECT_HEAVY_CLICK : "click".equals(weight) ? VibrationEffect.EFFECT_CLICK : VibrationEffect.EFFECT_TICK);
        if (effect != null) {
            if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH));
            else vibrator.vibrate(effect);
        } else if (view != null) {
            view.performHapticFeedback("heavy".equals(weight) ? HapticFeedbackConstants.LONG_PRESS
                : "click".equals(weight) ? HapticFeedbackConstants.VIRTUAL_KEY : HapticFeedbackConstants.KEYBOARD_TAP);
        }
    }
}
