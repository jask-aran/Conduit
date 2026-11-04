package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.app.Dialog;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.SystemClock;
import android.text.TextPaint;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;

/**
 * Float's radial: a fan of slots opening inward from Float's edge, centred on the handle. The outer arc holds the four
 * targets (jbot nearest the top); the inner arc holds Screenshot and Camera when it was opened by a tap, or Cancel alone
 * while a hold records. See docs/plans/float.md.
 *
 * Its own full-screen overlay window. Opened by a tap it takes touches itself (a tap on a slot chooses it, anywhere else
 * closes); opened by a hold the finger still belongs to the handle's window, so it takes no touches and the handle feeds
 * it the finger's screen position through {@link #track} and {@link #release}.
 */
final class FloatRadial {
    enum Slot {
        JBOT("jbot", R.drawable.ic_stat_conduit), NEW_CHAT("New chat", R.drawable.float_new_chat),
        WORKSPACE("Workspace", R.drawable.float_workspace), RECENT("Recent", R.drawable.float_recent),
        SCREENSHOT("Screenshot", R.drawable.float_screenshot), CAMERA("Camera", R.drawable.float_camera),
        CANCEL("Cancel", R.drawable.float_cancel);
        final String label; final int icon;
        Slot(String label, int icon) { this.label = label; this.icon = icon; }
        boolean target() { return ordinal() <= RECENT.ordinal(); }
    }

    interface Listener {
        /** The slot under the finger changed (null: none). */
        default void hover(Slot slot) {}
        /** Opened by a tap: a slot was tapped. The radial has started closing. */
        void chosen(Slot slot);
        /** Opened by a tap: a tap fell outside every slot. The radial has started closing. */
        void dismissed();
    }

    private static final Slot[] TARGETS = { Slot.JBOT, Slot.NEW_CHAT, Slot.WORKSPACE, Slot.RECENT };
    private static final Slot[] CONTEXT = { Slot.SCREENSHOT, Slot.CAMERA };
    private static final Slot[] HOLDING = { Slot.CANCEL };
    /** dp: arc radii, a slot's diameter, how near a finger must be to count as on it, the screen margin kept clear. */
    private static final float OUTER = 96, INNER = 54, SLOT = 48, REACH = 34, MARGIN = 8;
    /** Degrees each side of the inward direction the outer arc spreads; the inner arc's pair sits at ±INNER_SPREAD. */
    private static final float SPREAD = 66, INNER_SPREAD = 30;
    private static final long OPEN_MS = 220, CLOSE_MS = 160, STAGGER_MS = 18;

    private final Context context;
    private final Listener listener;
    private final Dialog dialog;
    private final Window window;
    private final RadialView view;
    private Slot[] slots = new Slot[0];
    private float[] slotX = new float[0], slotY = new float[0];
    private float anchorX, anchorY;
    private boolean holding, open;
    private Slot hovered;
    /** 0 closed .. 1 open, the whole fan's progress; each slot reads it with its own stagger. */
    private float shown;
    private ValueAnimator motion;
    private long motionStart;
    private boolean closing;

    FloatRadial(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        view = new RadialView(context);
        dialog = new Dialog(context, R.style.ConduitFloatTheme);
        dialog.setCancelable(false);
        window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        window.setContentView(view);
        window.getDecorView().setPadding(0, 0, 0, 0);
        WindowManager.LayoutParams position = window.getAttributes();
        position.format = PixelFormat.TRANSLUCENT;
        position.width = WindowManager.LayoutParams.MATCH_PARENT;
        position.height = WindowManager.LayoutParams.MATCH_PARENT;
        if (Build.VERSION.SDK_INT >= 28)
            position.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if (Build.VERSION.SDK_INT >= 30) position.setFitInsetsTypes(0);
        window.setAttributes(position);
    }

    private float dp(float value) { return value * context.getResources().getDisplayMetrics().density; }

    boolean isOpen() { return open; }

    /**
     * Opens around the handle. right: Float sits on the right edge; centreX/centreY: the handle's centre in screen
     * pixels; screenWidth/screenHeight: the whole screen in pixels; hold: opened by a hold (no touches, Cancel inside).
     */
    void open(boolean right, float centreX, float centreY, int screenWidth, int screenHeight, boolean hold) {
        holding = hold;
        hovered = null;
        anchorX = centreX;
        anchorY = centreY;
        Slot[] inner = hold ? HOLDING : CONTEXT;
        slots = new Slot[TARGETS.length + inner.length];
        System.arraycopy(TARGETS, 0, slots, 0, TARGETS.length);
        System.arraycopy(inner, 0, slots, TARGETS.length, inner.length);
        slotX = new float[slots.length];
        slotY = new float[slots.length];
        layout(right, screenWidth, screenHeight);
        setTouchable(!hold);
        if (!dialog.isShowing()) dialog.show();
        open = true;
        animate(true);
    }

    /** The fan's slots, turned away from the top or bottom of the screen just enough that every slot stays on it. */
    private void layout(boolean right, int width, int height) {
        float inward = right ? 180 : 0, margin = dp(MARGIN) + dp(SLOT) / 2;
        // Turn in 4° steps toward the screen's middle until every slot fits; the inward direction is never passed by
        // more than the spread, so the fan still opens away from the edge.
        // Angles are counter-clockwise with y up: on the right edge a larger angle points lower, on the left a smaller one.
        float towardMiddle = anchorY < height / 2f ? (right ? 1 : -1) : (right ? -1 : 1);
        for (float turn = 0; turn <= 80; turn += 4) {
            place(inward + towardMiddle * turn, right);
            boolean fits = true;
            for (int i = 0; i < slots.length; i++)
                if (slotY[i] < margin || slotY[i] > height - margin || slotX[i] < margin || slotX[i] > width - margin) fits = false;
            if (fits) return;
        }
    }

    private void place(float centre, boolean right) {
        // Angles counter-clockwise, y up (put() flips to the screen's y). jbot first, nearest the top: on the right edge
        // the fan's top end is centre - SPREAD (pointing up-left), on the left edge centre + SPREAD (up-right).
        float sign = right ? -1 : 1;
        for (int i = 0; i < TARGETS.length; i++) {
            float angle = centre + sign * (SPREAD - 2 * SPREAD * i / (TARGETS.length - 1));
            put(i, angle, OUTER);
        }
        int inner = slots.length - TARGETS.length;
        for (int j = 0; j < inner; j++) {
            float angle = inner == 1 ? centre : centre + sign * (INNER_SPREAD - 2 * INNER_SPREAD * j / (inner - 1));
            put(TARGETS.length + j, angle, INNER);
        }
    }

    private void put(int index, float degrees, float radius) {
        double a = Math.toRadians(degrees);
        slotX[index] = anchorX + (float) Math.cos(a) * dp(radius);
        slotY[index] = anchorY - (float) Math.sin(a) * dp(radius);
    }

    /** While a hold records: the finger's screen position. Returns the slot under it (null: none). */
    Slot track(float rawX, float rawY) {
        if (!open || closing) return null;
        int[] origin = new int[2];
        view.getLocationOnScreen(origin);
        hoverSlot(slotAt(rawX - origin[0], rawY - origin[1]));
        return hovered;
    }

    /** A hold let go (or locked onto a slot): the slot it ended on, and the radial closes. */
    Slot release() {
        Slot slot = hovered;
        close();
        return slot;
    }

    void close() {
        if (!open || closing) return;
        closing = true;
        setTouchable(false);
        animate(false);
    }

    /** Gone this instant, with no fade: before a screenshot, so the radial is not in it. */
    void hideNow() {
        if (motion != null) motion.cancel();
        open = false;
        closing = false;
        hovered = null;
        shown = 0;
        if (dialog.isShowing()) dialog.dismiss();
    }

    void destroy() {
        if (motion != null) motion.cancel();
        open = false;
        if (dialog.isShowing()) dialog.dismiss();
    }

    private Slot slotAt(float x, float y) {
        Slot best = null;
        float nearest = dp(REACH);
        for (int i = 0; i < slots.length; i++) {
            float d = (float) Math.hypot(x - slotX[i], y - slotY[i]);
            if (d <= nearest) { nearest = d; best = slots[i]; }
        }
        return best;
    }

    private void hoverSlot(Slot slot) {
        if (slot == hovered) return;
        hovered = slot;
        if (slot != null) view.performHapticFeedback(Build.VERSION.SDK_INT >= 27
            ? HapticFeedbackConstants.TEXT_HANDLE_MOVE : HapticFeedbackConstants.CLOCK_TICK);
        listener.hover(slot);
        view.invalidate();
    }

    private void setTouchable(boolean touchable) {
        WindowManager.LayoutParams position = window.getAttributes();
        if (touchable) position.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        else position.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        window.setAttributes(position);
    }

    private void animate(boolean opening) {
        if (motion != null) motion.cancel();
        closing = !opening;
        float from = shown, to = opening ? 1 : 0;
        long stagger = STAGGER_MS * Math.max(0, slots.length - 1);
        motion = ValueAnimator.ofFloat(from, to);
        motion.setDuration((opening ? OPEN_MS : CLOSE_MS) + stagger);
        motion.setInterpolator(new android.view.animation.LinearInterpolator());
        motion.addUpdateListener(animation -> { shown = (float) animation.getAnimatedValue(); view.invalidate(); });
        motion.addListener(new android.animation.AnimatorListenerAdapter() {
            private boolean cancelled;
            @Override public void onAnimationCancel(android.animation.Animator animation) { cancelled = true; }
            @Override public void onAnimationEnd(android.animation.Animator animation) {
                if (cancelled || opening) return;
                open = false;
                closing = false;
                hovered = null;
                if (dialog.isShowing()) dialog.dismiss();
            }
        });
        motionStart = SystemClock.uptimeMillis();
        motion.start();
    }

    /** The view: dense frost circles (one window cannot blur under each slot), each slot's icon, the hovered one's name. */
    private final class RadialView extends View {
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), rim = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint text = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final PathInterpolator curve = new PathInterpolator(.2f, 0f, 0f, 1f);
        private final Drawable[] icons = new Drawable[Slot.values().length];
        private final RectF box = new RectF();

        RadialView(Context context) {
            super(context);
            rim.setStyle(Paint.Style.STROKE);
            rim.setStrokeWidth(dp(1));
            text.setTextSize(dp(13));
            text.setColor(0xffe8e9eb);
            for (Slot slot : Slot.values()) icons[slot.ordinal()] = context.getDrawable(slot.icon).mutate();
        }

        /** A slot's own progress: the fan's, delayed by its place (inner first on open, so it grows outward). */
        private float progress(int index) {
            long total = (closing ? CLOSE_MS : OPEN_MS) + STAGGER_MS * Math.max(0, slots.length - 1);
            int order = index >= TARGETS.length ? index - TARGETS.length : index + (slots.length - TARGETS.length);
            float delay = STAGGER_MS * order / (float) total, span = 1 - STAGGER_MS * Math.max(0, slots.length - 1) / (float) total;
            float local = Math.max(0, Math.min(1, (shown - delay) / Math.max(.01f, span)));
            return curve.getInterpolation(local);
        }

        @Override protected void onDraw(Canvas canvas) {
            int[] origin = new int[2];
            getLocationOnScreen(origin);
            float ax = anchorX - origin[0], ay = anchorY - origin[1];
            for (int i = 0; i < slots.length; i++) {
                float p = progress(i);
                if (p <= 0) continue;
                Slot slot = slots[i];
                boolean hot = slot == hovered;
                float x = ax + (slotX[i] - origin[0] - ax) * p, y = ay + (slotY[i] - origin[1] - ay) * p;
                float r = dp(SLOT) / 2 * (.6f + .4f * p) * (hot ? 1.12f : 1);
                int alpha = Math.round(255 * Math.min(1, p * 1.4f));
                // Frost without blur: v2's white fill over the dark core, the denser no-blur ground; brighter when hot.
                fill.setColor(androidx.core.graphics.ColorUtils.compositeColors(hot ? 0x47ffffff : 0x2bffffff, 0xfa3a3b3f));
                fill.setAlpha(alpha);
                canvas.drawCircle(x, y, r, fill);
                rim.setColor(Color.argb(Math.round(alpha * .3f), 255, 255, 255));
                canvas.drawCircle(x, y, r - dp(.5f), rim);
                Drawable icon = icons[slot.ordinal()];
                int half = Math.round(dp(slot == Slot.JBOT ? 12 : 11) * (hot ? 1.08f : 1));
                icon.setTint(slot == Slot.CANCEL && hot ? 0xffff8a80 : 0xffe8e9eb);
                icon.setAlpha(alpha);
                icon.setBounds(Math.round(x - half), Math.round(y - half), Math.round(x + half), Math.round(y + half));
                icon.draw(canvas);
                if (hot && p >= 1) drawLabel(canvas, slot.label, x, y, r, ax);
            }
        }

        /** The hovered slot's name, in a small frost pill on its inward side, away from the screen's edge. */
        private void drawLabel(Canvas canvas, String name, float x, float y, float r, float ax) {
            float w = text.measureText(name) + dp(20), h = dp(26), gap = dp(8);
            boolean leftward = x <= ax; // on the right edge the slots lie left of the handle: the name goes further left
            float left = leftward ? x - r - gap - w : x + r + gap;
            box.set(left, y - h / 2, left + w, y + h / 2);
            label.setColor(androidx.core.graphics.ColorUtils.compositeColors(0x2bffffff, 0xfa3a3b3f));
            canvas.drawRoundRect(box, h / 2, h / 2, label);
            canvas.drawText(name, box.left + dp(10), y - (text.ascent() + text.descent()) / 2, text);
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            if (holding || closing) return false;
            int[] origin = new int[2];
            getLocationOnScreen(origin);
            Slot under = slotAt(event.getRawX() - origin[0], event.getRawY() - origin[1]);
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                case MotionEvent.ACTION_MOVE:
                    hoverSlot(under);
                    return true;
                case MotionEvent.ACTION_UP:
                    hoverSlot(null);
                    close();
                    if (under != null) { performClick(); listener.chosen(under); }
                    else listener.dismissed();
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    hoverSlot(null);
                    return true;
                default: return true;
            }
        }

        @Override public boolean performClick() { return super.performClick(); }
    }
}
