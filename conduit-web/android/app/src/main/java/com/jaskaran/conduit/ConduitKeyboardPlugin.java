package com.jaskaran.conduit;

import android.view.WindowManager;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.Locale;

/**
 * Report where the keyboard is, every frame it is moving.
 *
 * Android animates the IME as an inset rather than moving it in one step, and
 * `WindowInsetsAnimationCompat` is the only place that interpolated position
 * can be read. The page sizes its shell from it, so the composer travels on the
 * keyboard's own curve instead of arriving at the end of it -- which is the
 * difference between a composer that sticks to the keyboard and one that jumps
 * to where the keyboard is about to be.
 *
 * Three things have to be true before a frame arrives, and the third is the
 * one that cost the time.
 *
 * The window must be out of legacy soft-input handling, where the framework
 * resizes it in one pass and runs no animation to follow -- hence
 * `SOFT_INPUT_ADJUST_NOTHING` here and `setDecorFitsSystemWindows(false)` in
 * `MainActivity`, which together leave the keyboard to overlay the page and the
 * page's height to the page. Nothing else may be moving the same surface, so
 * SystemBars' `insetsHandling` is `disable` and the safe-area variables it
 * injected are injected here instead -- the same names, so the stylesheets do
 * not know the difference, and the same rule that the bottom inset is the
 * keyboard's business while the keyboard is up.
 *
 * And `@capacitor/keyboard` must not be installed. It registers an animation
 * callback of its own, on the root view, with `DISPATCH_MODE_STOP` -- which
 * means precisely that the animation is not dispatched to anything beneath it.
 * It keeps `onStart` and `onEnd`, to report the keyboard's height once it has
 * settled, and discards the `onProgress` frames in between. So every callback
 * below the root, on any view, for any inset, silently receives nothing: the
 * plugin loads, the listener attaches, and no frame ever comes. That is the
 * whole of why the keyboard moved in one step, and removing the package is the
 * whole of the fix. Its one remaining job, reporting the height, is this
 * plugin's now.
 */
@CapacitorPlugin(name = "ConduitKeyboard")
public class ConduitKeyboardPlugin extends Plugin {

    private float density = 1f;
    /** The height already announced, to keep identical frames off the bridge. */
    private int lastSent = -1;
    /** Whether the keyboard is mid-travel, and so reporting its own position. */
    private boolean animating = false;

    @Override
    public void load() {
        density = getActivity().getResources().getDisplayMetrics().density;
        getActivity().getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        final View host = (View) getBridge().getWebView().getParent();


        ViewCompat.setOnApplyWindowInsetsListener(host, (v, insets) -> {
            injectSafeArea(insets);
            // The end of the story, and the whole of it where the platform
            // declines to animate: a keyboard that appears without a curve
            // still has to be reported, or the shell never learns it is there.
            //
            // Not while one is running, though. Insets are applied once at the
            // start of an animation carrying the height the keyboard will
            // finish at, and honouring that is the composer arriving before the
            // keyboard does -- the jump this exists to remove.
            if (!animating) emit(imeHeight(insets), false);
            return insets;
        });

        ViewCompat.setWindowInsetsAnimationCallback(
            host,
            new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public void onPrepare(WindowInsetsAnimationCompat animation) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) animating = true;
                }

                @Override
                public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> running) {
                    emit(imeHeight(insets), true);
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

    private int imeHeight(WindowInsetsCompat insets) {
        if (!insets.isVisible(WindowInsetsCompat.Type.ime())) return 0;
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        return Math.round(ime.bottom / density);
    }

    /**
     * A frame the page has not been told about yet. Identical heights are
     * dropped because an animation reports every frame whether or not it moved,
     * and each one that reaches the page costs a layout.
     */
    private void emit(int height, boolean moving) {
        if (height == lastSent && moving) return;
        lastSent = height;
        JSObject payload = new JSObject();
        payload.put("height", height);
        payload.put("animating", moving);
        notifyListeners("keyboardGeometry", payload);
    }

    /**
     * The same four variables Capacitor's `insetsHandling: "css"` wrote, since
     * turning that off to stop it padding the parent also turned this off.
     *
     * The bottom one goes to zero while the keyboard is up: the gesture bar is
     * behind the keyboard then, and padding the composer clear of something
     * nothing can touch is the strip of empty space under the transcript.
     */
    private void injectSafeArea(WindowInsetsCompat insets) {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
        String script = String.format(
            Locale.US,
            "try{var s=document.documentElement.style;" +
            "s.setProperty('--safe-area-inset-top','%dpx');" +
            "s.setProperty('--safe-area-inset-right','%dpx');" +
            "s.setProperty('--safe-area-inset-bottom','%dpx');" +
            "s.setProperty('--safe-area-inset-left','%dpx');}catch(e){}",
            Math.round(bars.top / density),
            Math.round(bars.right / density),
            keyboard ? 0 : Math.round(bars.bottom / density),
            Math.round(bars.left / density)
        );
        getBridge().getWebView().evaluateJavascript(script, null);
    }
}
