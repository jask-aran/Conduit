package com.jaskaran.conduit;

import android.view.WindowManager;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.Locale;

/**
 * The keyboard's travel, read from `WindowInsetsAnimationCompat` so the composer follows its curve.
 * Needs `SOFT_INPUT_ADJUST_NOTHING` here, `setDecorFitsSystemWindows(false)` in `MainActivity`, SystemBars'
 * `insetsHandling: "disable"`, and `@capacitor/keyboard` not installed: its root callback uses `DISPATCH_MODE_STOP`,
 * which hides every `onProgress` frame from callbacks below it.
 */
@CapacitorPlugin(name = "ConduitKeyboard")
public class ConduitKeyboardPlugin extends Plugin {

    private static final int CURVE_SAMPLES = 24;

    private float density = 1f;
    private View hostView = null;
    private int lastSent = -1;
    private boolean animating = false;
    private WindowInsetsCompat lastInsets = null;

    @Override
    public void load() {
        density = getActivity().getResources().getDisplayMetrics().density;
        getActivity().getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        final View host = (View) getBridge().getWebView().getParent();
        hostView = host;


        ViewCompat.setOnApplyWindowInsetsListener(host, (v, insets) -> {
            lastInsets = insets;
            injectSafeArea(insets);
            // Reports a keyboard that appears without animating. Skipped mid-animation: insets are applied once at its
            // start carrying the final height, and the composer would jump there ahead of the keyboard.
            if (!animating) emit(imeHeight(insets), false);
            return insets;
        });

        ViewCompat.setWindowInsetsAnimationCallback(
            host,
            new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public WindowInsetsAnimationCompat.BoundsCompat onStart(WindowInsetsAnimationCompat animation, WindowInsetsAnimationCompat.BoundsCompat bounds) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) announce(animation, bounds);
                    return bounds;
                }

                @Override
                public void onPrepare(WindowInsetsAnimationCompat animation) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) animating = true;
                }

                @Override
                public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> running) {
                    // The page's clock starts when the description arrives, a bridge-width late; the system's fraction
                    // lets it correct.
                    float fraction = -1f;
                    for (WindowInsetsAnimationCompat animation : running) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
                            fraction = animation.getInterpolatedFraction();
                            break;
                        }
                    }
                    emit(animatingImeHeight(insets), true, fraction);
                    return insets;
                }

                @Override
                public void onEnd(WindowInsetsAnimationCompat animation) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0) return;
                    animating = false;
                    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(host);
                    if (insets != null) emit(imeHeight(insets), false);
                }
            }
        );

        host.requestApplyInsets();
    }

    /**
     * The whole travel sent once as a description (bounds, duration, sampled interpolator), so the page draws it at
     * the display's rate rather than the bridge's. The curve is sampled because Android's interpolator varies by release.
     */
    private void announce(WindowInsetsAnimationCompat animation, WindowInsetsAnimationCompat.BoundsCompat bounds) {
        // The bounds are a range, not a direction: lower is the smaller inset whichever way the keyboard is going.
        WindowInsetsCompat now = ViewCompat.getRootWindowInsets(hostView);
        int here = now == null ? 0 : (now.isVisible(WindowInsetsCompat.Type.ime()) ? animatingImeHeight(now) : 0);
        int low = Math.round(bounds.getLowerBound().bottom / density);
        int high = Math.round(bounds.getUpperBound().bottom / density);
        // Insets are already applied for the destination, so the bound nearest `here` is the end. Asking whether the
        // keyboard is showing gets a height change while visible (number row, one-handed) backwards.
        int to = Math.abs(here - low) <= Math.abs(here - high) ? low : high;
        JSObject payload = new JSObject();
        payload.put("from", to == low ? high : low);
        payload.put("to", to);
        // The animation's duration is unscaled, but the system's animator scale slows the keyboard itself.
        float durationScale = android.os.Build.VERSION.SDK_INT >= 33 ? android.animation.ValueAnimator.getDurationScale() : 1;
        payload.put("durationMs", Math.round(animation.getDurationMillis() * durationScale));
        JSArray curve = new JSArray();
        android.view.animation.Interpolator in = animation.getInterpolator();
        try {
            for (int k = 0; k <= CURVE_SAMPLES; k++) {
                float t = (float) k / CURVE_SAMPLES;
                curve.put((double) Math.round((in == null ? t : in.getInterpolation(t)) * 1000) / 1000);
            }
        } catch (org.json.JSONException ignored) {
            // The per-frame events still settle the keyboard without a description.
            return;
        }
        payload.put("curve", curve);
        payload.put("here", here);
        // Wall clock, because the page reads the same one.
        payload.put("startedAt", System.currentTimeMillis());
        notifyListeners("keyboardAnimation", payload);
    }

    /** Not gated on visibility: it flips at the start of a hide, which would read 0 for every frame of it. */
    private int animatingImeHeight(WindowInsetsCompat insets) {
        return Math.round(insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / density);
    }

    private int imeHeight(WindowInsetsCompat insets) {
        if (!insets.isVisible(WindowInsetsCompat.Type.ime())) return 0;
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        return Math.round(ime.bottom / density);
    }

    /** Identical heights mid-animation are dropped: each one that reaches the page costs a layout. */
    private void emit(int height, boolean moving) {
        emit(height, moving, -1f);
    }

    private void emit(int height, boolean moving, float fraction) {
        if (height == lastSent && moving) return;
        lastSent = height;
        JSObject payload = new JSObject();
        payload.put("height", height);
        payload.put("animating", moving);
        payload.put("fraction", fraction);
        notifyListeners("keyboardGeometry", payload);
    }

    /** Asked for by the page when it starts: insets applied before it committed never reached it. */
    @PluginMethod
    public void safeArea(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            WindowInsetsCompat insets = lastInsets != null ? lastInsets : hostView == null ? null : ViewCompat.getRootWindowInsets(hostView);
            if (insets == null) { call.reject("No insets yet"); return; }
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            JSObject result = new JSObject();
            result.put("top", Math.round(bars.top / density));
            result.put("right", Math.round(bars.right / density));
            result.put("bottom", Math.round(bars.bottom / density));
            result.put("left", Math.round(bars.left / density));
            call.resolve(result);
        });
    }

    private void injectSafeArea(WindowInsetsCompat insets) {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        // The resting bottom inset, never zeroed for the keyboard: a 0 would be a step where the keyboard is a curve.
        // The page takes the keyboard off it frame by frame.
        String script = String.format(
            Locale.US,
            "try{var s=document.documentElement.style;" +
            "s.setProperty('--safe-area-inset-top','%1$dpx');" +
            "s.setProperty('--safe-area-inset-right','%2$dpx');" +
            "s.setProperty('--safe-area-inset-bottom-rest','%3$dpx');" +
            "s.setProperty('--safe-area-inset-left','%4$dpx');}catch(e){}",
            Math.round(bars.top / density),
            Math.round(bars.right / density),
            Math.round(bars.bottom / density),
            Math.round(bars.left / density)
        );
        getBridge().getWebView().evaluateJavascript(script, null);
    }
}
