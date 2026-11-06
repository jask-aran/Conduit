package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.graphics.BlurMaskFilter;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.PopupWindow;
import java.util.HashMap;
import java.util.Map;

/**
 * The native composer's live frost, while the keyboard stands still. A live blur of the transcript can only be drawn by
 * the compositor in a layer above the app's (the app paints the transcript and the composer into one picture), so this
 * is a window over the app that can take neither focus nor touches: each pill and the field drawn there as the web's
 * .ui-frost (styles/frost.css) over Samsung's live blur, with a copy of what the real part shows (its icon; the field's
 * text, caret and selection), redrawn whenever the app's window draws. The real composer stays where it is, keeping the
 * keyboard and every touch, drawn at opacity 0 while this shows.
 *
 * Never during the keyboard's travel: only the window running that animation keeps step with the keyboard, so this
 * comes in once the travel ends and goes before the next one starts. Where the blur is not available it never shows,
 * and the composer keeps its flat frost.
 *
 * One composer is always whole on screen. Arriving, the glass's edges and contents are drawn at once, over the real
 * composer, and only its fill fades in as the real composer fades out under it (the blur of an opaque pill is that
 * pill); leaving, the real composer is drawn again first and this window goes once that frame is out.
 */
final class ComposerFrost {
    /* The web's frost (foundations.css): --frost-blur, --frost-fill, --frost-stroke, --frost-highlight, --frost-lift-rest. */
    private static final float BLUR_CSS = 24;
    private static final int FILL = 0x2bffffff, STROKE = 0x4dffffff, HIGHLIGHT_TOP = 0x80ffffff, HIGHLIGHT_BOTTOM = 0x1affffff;
    private static final float LIFT_Y_CSS = 8, LIFT_BLUR_CSS = 32; private static final int LIFT = 0x1a000000;

    interface Corner { float of(View part); }

    private final Activity activity;
    private final FrameLayout content, root;
    private final Map<String, ConduitMoves.Part> parts;
    private final float scale;
    private final Corner corner;
    private final long fadeMs;
    private PopupWindow window;
    private Layer layer;
    private ViewTreeObserver observer;
    private ValueAnimator fade;
    /** The glass's fill, 0 to 1; the real composer is drawn at 1 - shown. */
    private float shown;
    private boolean leaving;
    private final ViewTreeObserver.OnDrawListener onDraw = this::sync;

    ComposerFrost(Activity activity, FrameLayout content, FrameLayout root, Map<String, ConduitMoves.Part> parts, float scale, Corner corner, long fadeMs) {
        this.activity = activity; this.content = content; this.root = root; this.parts = parts; this.scale = scale; this.corner = corner; this.fadeMs = fadeMs;
    }

    static boolean available() { return FloatLiveBlur.available(); }

    /** An experiment, set over adb (`setprop debug.conduit.frost_travel 1`): the frost kept up through the keyboard's travel. */
    static boolean throughTravel() {
        try {
            Object value = Class.forName("android.os.SystemProperties").getMethod("get", String.class).invoke(null, "debug.conduit.frost_travel");
            return "1".equals(value);
        } catch (Throwable unavailable) { return false; }
    }

    boolean showing() { return window != null && !leaving; }

    /** The frost window over the composer, ending at keyboardBottom (never over the keyboard); fadeMs 0 arrives at once. */
    void show(int keyboardBottom, long fadeMs) {
        if (leaving) close();
        int height = content.getHeight() - Math.max(0, keyboardBottom);
        if (window != null || !available() || content.getWidth() == 0 || height <= 0) return;
        layer = new Layer(activity);
        window = new PopupWindow(layer, content.getWidth(), height, false);
        window.setTouchable(false);
        window.setClippingEnabled(false);
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        // Nothing to do with the keyboard: a window that may take part in it can become the one that runs the keyboard's
        // animation, which is the app's.
        window.setInputMethodMode(PopupWindow.INPUT_METHOD_NOT_NEEDED);
        window.setAnimationStyle(0);
        window.setElevation(0);
        int[] at = new int[2]; content.getLocationOnScreen(at);
        try { window.showAtLocation(content, Gravity.NO_GRAVITY, at[0], at[1]); }
        catch (RuntimeException notNow) { window = null; layer = null; return; }
        observer = content.getViewTreeObserver();
        observer.addOnDrawListener(onDraw);
        shown = 0; sync();
        // The fill comes in, and the real composer goes, only once this window's first frame is out: until then the real
        // composer is all there is to see.
        Layer showing = layer;
        afterFrame(layer, () -> {
            if (layer != showing || leaving) return;
            fade = ValueAnimator.ofFloat(0, 1);
            fade.setDuration(fadeMs);
            fade.addUpdateListener(value -> { shown = (float) value.getAnimatedValue(); sync(); });
            fade.start();
        });
    }
    void show(int keyboardBottom) { show(keyboardBottom, fadeMs); }

    /** Before the keyboard moves again: the real composer drawn again, and this window gone once that frame is out. */
    void hide() {
        if (window == null || leaving) return;
        if (fade != null) { fade.cancel(); fade = null; }
        leaving = true;
        root.setAlpha(1);
        PopupWindow going = window;
        content.invalidate();
        afterFrame(content, () -> { if (window == going) close(); });
    }

    /** Once view's window has handed its next frame to the compositor (a frame later where that cannot be told). */
    private static void afterFrame(View view, Runnable then) {
        if (android.os.Build.VERSION.SDK_INT >= 29) view.getViewTreeObserver().registerFrameCommitCallback(() -> view.post(then));
        else view.postOnAnimation(() -> view.postOnAnimation(then));
    }

    /** At once: the composer is going. */
    void close() {
        if (fade != null) { fade.cancel(); fade = null; }
        if (observer != null && observer.isAlive()) observer.removeOnDrawListener(onDraw);
        observer = null;
        root.setAlpha(1);
        if (window != null) { try { window.dismiss(); } catch (RuntimeException ignored) {} }
        window = null; layer = null; shown = 0; leaving = false;
    }

    /** Each frame the app's window draws: the glass follows its part, and the real composer fades as the fill arrives. */
    private void sync() {
        if (layer == null) return;
        if (!leaving) root.setAlpha(1 - shown);
        float lift = root.getTranslationY();
        Map<View, Glass> seen = new HashMap<>();
        StringBuilder shape = new StringBuilder();
        Path blur = new Path();
        for (ConduitMoves.Part part : parts.values()) {
            if (part.state == null) continue;
            String kind = part.state.optString("kind");
            if (!"pill".equals(kind) && !"field".equals(kind)) continue;
            Glass glass = layer.glasses.get(part.view);
            if (glass == null) {
                glass = new Glass(activity, part.view, corner.of(part.view));
                layer.glasses.put(part.view, glass);
                layer.addView(glass);
            }
            seen.put(part.view, glass);
            View real = part.view;
            float opacity = real.getVisibility() == View.VISIBLE ? real.getAlpha() : 0;
            int top = Math.round(real.getTop() + lift);
            glass.layout(real.getLeft(), top, real.getRight(), top + real.getHeight());
            glass.setClipBounds(real.getClipBounds());
            glass.set(opacity, shown);
            glass.invalidate();
            // The blur is one region, every part's shape in it: a part fading is in it from halfway.
            if (opacity >= .5f && real.getWidth() > 0 && real.getHeight() > 0) {
                float r = Math.min(glass.radius, Math.min(real.getWidth(), real.getHeight()) / 2f);
                blur.addRoundRect(new RectF(real.getLeft(), top, real.getRight(), top + real.getHeight()), r, r, Path.Direction.CW);
                shape.append(real.getLeft()).append(',').append(top).append(',').append(real.getWidth()).append(',').append(real.getHeight()).append(';');
            }
        }
        for (View real : new java.util.ArrayList<>(layer.glasses.keySet())) if (!seen.containsKey(real)) layer.removeView(layer.glasses.remove(real));
        layer.blur(shape.toString(), blur);
        layer.invalidate();
    }

    /** The window's content: the blur behind every part, then each part's glass, each with its lift drawn outside it. */
    private final class Layer extends ViewGroup {
        final Map<View, Glass> glasses = new HashMap<>();
        private final View back;
        private String blurred = null;
        private final int radius = Math.round(Math.max(1, (BLUR_CSS * scale - .5f) / .57735f));
        private final Paint lift = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path box = new Path();
        Layer(Context context) {
            super(context);
            setWillNotDraw(false);
            back = new View(context);
            addView(back);
            // CSS's blur radius is twice its sigma; Skia's blur takes a radius that it turns into sigma = .57735r + .5.
            float sigma = LIFT_BLUR_CSS / 2 * scale;
            lift.setMaskFilter(new BlurMaskFilter(Math.max(1, (sigma - .5f) / .57735f), BlurMaskFilter.Blur.NORMAL));
        }
        /** The one blur region, set again only when its shapes change. */
        void blur(String shape, Path path) {
            if (shape.equals(blurred) || !back.isAttachedToWindow()) return;
            blurred = shape;
            FloatLiveBlur.applyPath(back, radius, path);
        }
        @Override protected void onLayout(boolean changed, int l, int t, int r, int b) { back.layout(0, 0, r - l, b - t); }
        @Override protected void onDraw(Canvas canvas) {
            // box-shadow is painted only outside its box, so none shows through the glass.
            for (Glass glass : glasses.values()) {
                if (glass.opacity == 0 || glass.getWidth() == 0) continue;
                RectF at = new RectF(glass.getLeft(), glass.getTop(), glass.getRight(), glass.getBottom());
                float r = Math.min(glass.radius, Math.min(at.width(), at.height()) / 2);
                box.reset(); box.addRoundRect(at, r, r, Path.Direction.CW);
                canvas.save();
                canvas.clipOutPath(box);
                lift.setColor(Color.argb(Math.round(Color.alpha(LIFT) * glass.opacity), 0, 0, 0));
                at.offset(0, LIFT_Y_CSS * scale);
                canvas.drawRoundRect(at, r, r, lift);
                canvas.restore();
            }
        }
    }

    /** One part's frost over the blur: its fill, the highlights and the border, then the part's own content. */
    private final class Glass extends View {
        final View real;
        final float radius;
        float opacity, fill;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path outer = new Path(), inner = new Path(), shifted = new Path(), ring = new Path();
        Glass(Context context, View real, float radius) { super(context); this.real = real; this.radius = radius; }

        /** opacity: the part's own (its moves); fill: how far the fill has come in. */
        void set(float opacity, float fill) {
            this.opacity = opacity; this.fill = fill;
            setVisibility(opacity > 0 ? VISIBLE : INVISIBLE);
        }

        @Override protected void onDraw(Canvas canvas) {
            int w = getWidth(), h = getHeight();
            if (opacity <= 0 || w == 0 || h == 0) return;
            boolean faded = opacity < 1;
            if (faded) canvas.saveLayerAlpha(0, 0, w, h, Math.round(255 * opacity));
            float border = Math.max(1, (float) Math.floor(scale));
            float r = Math.min(radius, Math.min(w, h) / 2f);
            RectF box = new RectF(0, 0, w, h);
            outer.reset(); outer.addRoundRect(box, r, r, Path.Direction.CW);
            box.inset(border, border);
            float ri = Math.max(0, r - border);
            inner.reset(); inner.addRoundRect(box, ri, ri, Path.Direction.CW);
            paint.setStyle(Paint.Style.FILL);
            // background (under the border too), the inset highlights (the last listed first), the border: CSS's order.
            // Chromium draws a border whole device pixels wide (rounded down), and the inset shadows at their exact offset.
            paint.setColor(Color.argb(Math.round(Color.alpha(FILL) * fill), 255, 255, 255)); canvas.drawPath(outer, paint);
            crescent(canvas, -scale, HIGHLIGHT_BOTTOM);
            crescent(canvas, scale, HIGHLIGHT_TOP);
            ring.set(outer); ring.op(inner, Path.Op.DIFFERENCE);
            paint.setColor(STROKE); canvas.drawPath(ring, paint);
            contents(canvas);
            if (faded) canvas.restore();
        }
        /** An inset box-shadow with no blur: the padding box less itself moved by dy. */
        private void crescent(Canvas canvas, float dy, int colour) {
            shifted.set(inner); shifted.offset(0, dy);
            ring.set(inner); ring.op(shifted, Path.Op.DIFFERENCE);
            paint.setColor(colour); canvas.drawPath(ring, paint);
        }

        /** What the real part shows, drawn here without its own (flat) background. */
        private void contents(Canvas canvas) {
            canvas.save();
            Rect clip = real.getClipBounds();
            if (clip != null) canvas.clipRect(clip);
            if (real instanceof ImageButton) {
                ImageButton button = (ImageButton) real;
                Drawable glyph = button.getDrawable();
                if (glyph != null) {
                    canvas.translate(button.getPaddingLeft(), button.getPaddingTop());
                    canvas.concat(button.getImageMatrix());
                    glyph.draw(canvas);
                }
            } else if (real instanceof ViewGroup) {
                ViewGroup field = (ViewGroup) real;
                for (int i = 0; i < field.getChildCount(); i++) {
                    View child = field.getChildAt(i);
                    if (!(child instanceof EditText) || child.getVisibility() != VISIBLE) continue;
                    canvas.save();
                    canvas.clipRect(child.getLeft(), child.getTop(), child.getRight(), child.getBottom());
                    canvas.translate(child.getLeft() - child.getScrollX(), child.getTop() - child.getScrollY());
                    child.draw(canvas);
                    canvas.restore();
                }
            }
            canvas.restore();
        }
    }
}
