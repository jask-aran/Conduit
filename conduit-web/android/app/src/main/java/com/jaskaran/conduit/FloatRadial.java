package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.app.Dialog;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.os.Build;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;
import android.widget.ImageView;
import android.widget.TextView;

/**
 * Float's radial: what a tap on the handle opens. A semicircle of the four targets opens inward from Float's edge,
 * centred on the handle (jbot, New chat, Workspace, Recent from the top); further out, Screenshot and Camera. See
 * docs/plans/float.md.
 *
 * Each slot is its own small overlay window in v2's frost (FloatFrost), so the system blurs what is behind each one, as
 * it does behind Float's pill. Under them a transparent full-screen window takes the touches: a press on a slot lifts
 * it and names it; letting go on it chooses it; letting go anywhere else closes the radial.
 */
final class FloatRadial {
    enum Slot {
        JBOT("jbot", R.drawable.ic_stat_conduit), NEW_CHAT("New chat", R.drawable.float_new_chat),
        WORKSPACE("Workspace", R.drawable.float_workspace), RECENT("Recent", R.drawable.float_recent),
        SCREENSHOT("Screenshot", R.drawable.float_screenshot), CAMERA("Camera", R.drawable.float_camera);
        final String label; final int icon;
        Slot(String label, int icon) { this.label = label; this.icon = icon; }
        boolean target() { return ordinal() <= RECENT.ordinal(); }
    }

    interface Listener {
        /** A slot was chosen. The radial has started closing. */
        void chosen(Slot slot);
        /** Let go outside every slot. The radial has started closing. */
        void dismissed();
    }

    private static final Slot[] SLOTS = Slot.values();
    /** dp: the targets' arc, the context pair's arc, a slot's diameter, how near a finger counts, the margin kept. */
    private static final float INNER = 60, OUTER = 110, SLOT = 40, REACH = 26, MARGIN = 10;
    /** Degrees from the inward direction: the targets fan across ±TARGET_SPREAD, the context pair sits at ±OUTER_SPREAD. */
    private static final float TARGET_SPREAD = 72, OUTER_SPREAD = 18;
    /** v2's popover motion: rise in on --ease-arrive over --duration-gentle, drop out on --ease-leave over --duration-quick. */
    private static final long OPEN_MS = 250, CLOSE_MS = 150, STAGGER_MS = 22;
    private static final int ROW = 0xade8e9eb, FOREGROUND = 0xffe8e9eb;

    private final Context context;
    private final Listener listener;
    private final WindowManager manager;
    private final Dialog catcher;
    private final Dialog[] slotWindows = new Dialog[SLOTS.length];
    private final FloatFrost[] slotFrost = new FloatFrost[SLOTS.length];
    private final ImageView[] icons = new ImageView[SLOTS.length];
    private final Dialog label;
    private final TextView labelText;
    private final FloatFrost labelFrost;
    private final float[] slotX = new float[SLOTS.length], slotY = new float[SLOTS.length];
    private float anchorX, anchorY;
    private boolean open, closing, blurred;
    private Slot hovered;
    private float shown;
    private ValueAnimator motion;
    private final PathInterpolator arrive = new PathInterpolator(.2f, .8f, .2f, 1f), leave = new PathInterpolator(.4f, 0f, 1f, 1f);

    FloatRadial(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        manager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        View touches = new View(context) {
            @Override public boolean onTouchEvent(MotionEvent event) { return touch(event); }
        };
        catcher = overlay(touches, true);
        Typeface geist = androidx.core.content.res.ResourcesCompat.getFont(context, R.font.composer_geist);
        for (Slot slot : SLOTS) {
            int i = slot.ordinal();
            ImageView icon = new ImageView(context);
            icon.setImageResource(slot.icon);
            icon.setImageTintList(ColorStateList.valueOf(ROW));
            icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
            int pad = dp(slot == Slot.JBOT ? 10 : 11);
            icon.setPadding(pad, pad, pad, pad);
            icons[i] = icon;
            slotFrost[i] = new FloatFrost(-1, dp(.8f));
            slotWindows[i] = overlay(icon, false);
            slotWindows[i].getWindow().setBackgroundDrawable(slotFrost[i]);
        }
        labelText = new TextView(context);
        labelText.setTextSize(13.5f);
        labelText.setTextColor(FOREGROUND);
        labelText.setTypeface(Build.VERSION.SDK_INT >= 28 ? Typeface.create(geist, 500, false) : geist);
        labelText.setPadding(dp(10), dp(5), dp(10), dp(5));
        labelText.setSingleLine(true);
        labelFrost = new FloatFrost(-1, dp(.8f));
        label = overlay(labelText, false);
        label.getWindow().setBackgroundDrawable(labelFrost);
    }

    private int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    /** A Dialog as an overlay window placed in screen pixels; touchable only for the catcher. */
    private Dialog overlay(View content, boolean touchable) {
        Dialog dialog = new Dialog(context, R.style.ConduitFloatTheme);
        dialog.setCancelable(false);
        Window window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS | (touchable ? 0 : WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE));
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        window.setContentView(content);
        window.getDecorView().setPadding(0, 0, 0, 0);
        WindowManager.LayoutParams position = window.getAttributes();
        position.format = PixelFormat.TRANSLUCENT;
        position.gravity = Gravity.TOP | Gravity.LEFT;
        position.windowAnimations = 0;
        if (touchable) {
            position.width = WindowManager.LayoutParams.MATCH_PARENT;
            position.height = WindowManager.LayoutParams.MATCH_PARENT;
        }
        if (Build.VERSION.SDK_INT >= 28)
            position.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if (Build.VERSION.SDK_INT >= 30) position.setFitInsetsTypes(0);
        window.setAttributes(position);
        return dialog;
    }

    boolean isOpen() { return open; }

    /**
     * Opens around the handle. right: Float sits on the right edge; centreX/centreY: the handle's centre in screen
     * pixels; screenWidth/screenHeight: the whole screen in pixels.
     */
    void open(boolean right, float centreX, float centreY, int screenWidth, int screenHeight) {
        hovered = null;
        anchorX = centreX;
        anchorY = centreY;
        blurred = Build.VERSION.SDK_INT >= 31 && manager.isCrossWindowBlurEnabled();
        layout(right, screenWidth, screenHeight);
        if (!catcher.isShowing()) catcher.show();
        for (int i = 0; i < SLOTS.length; i++) {
            slotFrost[i].setBlurred(blurred);
            icons[i].setImageTintList(ColorStateList.valueOf(ROW));
            WindowManager.LayoutParams p = slotWindows[i].getWindow().getAttributes();
            p.width = p.height = dp(SLOT);
            slotWindows[i].getWindow().setAttributes(p);
            if (!slotWindows[i].isShowing()) slotWindows[i].show();
        }
        open = true;
        closing = false;
        animate(true);
    }

    /** The fan, turned away from the screen's top or bottom just enough that every slot stays on it. */
    private void layout(boolean right, int width, int height) {
        float inward = right ? 180 : 0, margin = dp(MARGIN) + dp(SLOT) / 2f;
        // Angles counter-clockwise with y up: on the right edge a larger angle points lower, on the left a smaller one.
        float towardMiddle = anchorY < height / 2f ? (right ? 1 : -1) : (right ? -1 : 1);
        for (float turn = 0; turn <= 80; turn += 4) {
            place(inward + towardMiddle * turn, right);
            boolean fits = true;
            for (int i = 0; i < SLOTS.length; i++)
                if (slotY[i] < margin || slotY[i] > height - margin || slotX[i] < margin || slotX[i] > width - margin) fits = false;
            if (fits) return;
        }
    }

    private void place(float centre, boolean right) {
        // From the top: on the right edge the fan's top end is centre - spread (up-left), on the left centre + spread.
        float sign = right ? -1 : 1;
        for (int i = 0; i < 4; i++) put(i, centre + sign * (TARGET_SPREAD - 2 * TARGET_SPREAD * i / 3), INNER);
        put(Slot.SCREENSHOT.ordinal(), centre + sign * OUTER_SPREAD, OUTER);
        put(Slot.CAMERA.ordinal(), centre - sign * OUTER_SPREAD, OUTER);
    }

    private void put(int index, float degrees, float radius) {
        double a = Math.toRadians(degrees);
        slotX[index] = anchorX + (float) Math.cos(a) * dp(radius);
        slotY[index] = anchorY - (float) Math.sin(a) * dp(radius);
    }

    void close() {
        if (!open || closing) return;
        closing = true;
        hover(null);
        animate(false);
    }

    /** Gone this instant, with no fade: before a screenshot, so the radial is not in it. */
    void hideNow() {
        if (motion != null) motion.cancel();
        open = closing = false;
        hovered = null;
        shown = 0;
        dismissAll();
    }

    void destroy() { hideNow(); }

    private void dismissAll() {
        if (label.isShowing()) label.dismiss();
        for (Dialog slot : slotWindows) if (slot.isShowing()) slot.dismiss();
        if (catcher.isShowing()) catcher.dismiss();
    }

    private Slot slotAt(float x, float y) {
        Slot best = null;
        float nearest = dp(REACH);
        for (int i = 0; i < SLOTS.length; i++) {
            float d = (float) Math.hypot(x - slotX[i], y - slotY[i]);
            if (d <= nearest) { nearest = d; best = SLOTS[i]; }
        }
        return best;
    }

    private boolean touch(MotionEvent event) {
        if (closing || !open) return true;
        Slot under = slotAt(event.getRawX(), event.getRawY());
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: case MotionEvent.ACTION_MOVE: hover(under); return true;
            case MotionEvent.ACTION_UP:
                close();
                if (under != null) listener.chosen(under);
                else listener.dismissed();
                return true;
            case MotionEvent.ACTION_CANCEL: hover(null); return true;
            default: return true;
        }
    }

    /** The slot under the finger lifts (white icon, a little larger) and its name shows beside it, inward. */
    private void hover(Slot slot) {
        if (slot == hovered) return;
        if (hovered != null) icons[hovered.ordinal()].setImageTintList(ColorStateList.valueOf(ROW));
        hovered = slot;
        if (slot == null) { if (label.isShowing()) label.dismiss(); frame(); return; }
        icons[slot.ordinal()].setImageTintList(ColorStateList.valueOf(FOREGROUND));
        icons[slot.ordinal()].performHapticFeedback(Build.VERSION.SDK_INT >= 27
            ? HapticFeedbackConstants.TEXT_HANDLE_MOVE : HapticFeedbackConstants.CLOCK_TICK);
        labelText.setText(slot.label);
        labelText.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
        int w = labelText.getMeasuredWidth(), h = labelText.getMeasuredHeight();
        int i = slot.ordinal();
        boolean leftward = slotX[i] <= anchorX;
        WindowManager.LayoutParams p = label.getWindow().getAttributes();
        p.width = w;
        p.height = h;
        p.x = Math.round(leftward ? slotX[i] - dp(SLOT) / 2f - dp(8) - w : slotX[i] + dp(SLOT) / 2f + dp(8));
        p.y = Math.round(slotY[i] - h / 2f);
        labelFrost.setBlurred(blurred);
        if (Build.VERSION.SDK_INT >= 31) label.getWindow().setBackgroundBlurRadius(blurred ? dp(24) : 0);
        label.getWindow().setAttributes(p);
        if (!label.isShowing()) label.show();
        frame();
    }

    private void animate(boolean opening) {
        if (motion != null) motion.cancel();
        closing = !opening;
        motion = ValueAnimator.ofFloat(shown, opening ? 1 : 0);
        motion.setDuration((opening ? OPEN_MS : CLOSE_MS) + STAGGER_MS * (SLOTS.length - 1));
        motion.setInterpolator(new android.view.animation.LinearInterpolator());
        motion.addUpdateListener(animation -> { shown = (float) animation.getAnimatedValue(); frame(); });
        motion.addListener(new android.animation.AnimatorListenerAdapter() {
            private boolean cancelled;
            @Override public void onAnimationCancel(android.animation.Animator animation) { cancelled = true; }
            @Override public void onAnimationEnd(android.animation.Animator animation) {
                if (cancelled || opening) return;
                open = closing = false;
                hovered = null;
                dismissAll();
            }
        });
        motion.start();
    }

    /** Each slot travels out from the handle on its own delay (targets first, then the context pair further out). */
    private void frame() {
        long total = (closing ? CLOSE_MS : OPEN_MS) + STAGGER_MS * (SLOTS.length - 1);
        float span = 1 - STAGGER_MS * (SLOTS.length - 1) / (float) total;
        for (int i = 0; i < SLOTS.length; i++) {
            float delay = STAGGER_MS * i / (float) total;
            float local = Math.max(0, Math.min(1, (shown - delay) / Math.max(.01f, span)));
            float p = closing ? 1 - leave.getInterpolation(1 - local) : arrive.getInterpolation(local);
            boolean hot = SLOTS[i] == hovered;
            int size = dp(SLOT);
            float x = anchorX + (slotX[i] - anchorX) * p, y = anchorY + (slotY[i] - anchorY) * p;
            Window window = slotWindows[i].getWindow();
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.x = Math.round(x - size / 2f);
            lp.y = Math.round(y - size / 2f);
            window.setAttributes(lp);
            View decor = window.getDecorView();
            decor.setAlpha(Math.min(1, p * 1.6f));
            float scale = (.7f + .3f * p) * (hot ? 1.1f : 1);
            decor.setScaleX(scale);
            decor.setScaleY(scale);
            if (Build.VERSION.SDK_INT >= 31) window.setBackgroundBlurRadius(blurred ? Math.round(dp(24) * p) : 0);
        }
    }
}
