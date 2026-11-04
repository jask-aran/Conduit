package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.app.Dialog;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;

/**
 * Float's radial: what a tap on the handle opens. One arc of six slots inward from Float's edge, centred on the handle:
 * jbot, New chat, Workspace, Recent, then (a slightly wider gap) Screenshot and Camera. Every slot is a tap target at
 * full strength. While captures are held, a ✕ sits under their card (FloatCaptures), in the column along the edge.
 * See docs/plans/float.md and the design sheet it links.
 *
 * One window draws everything (slots, names, ✕), so moving them is drawing, not relayouting windows, and the window
 * takes touches (Android caps an untouchable overlay at 80% opacity). Its frost draws the screen behind it, blurred,
 * when the screen reader can take it (FloatFrost's backdrop). While dictating only Screenshot and Camera stay, and the
 * window shrinks to them so the app underneath keeps its touches.
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
        /** A slot was tapped. JBOT and NEW_CHAT keep the radial as the dictation's context pair; the rest close it. */
        void chosen(Slot slot);
        /** A tap outside every slot. The radial has started closing. */
        void dismissed();
        /** The ✕ under the held captures. */
        void discard();
        /** The dictation's target bubble: choose where the words go instead. */
        void retarget();
    }

    private static final Slot[] SLOTS = Slot.values();
    /** dp: the arc's radius, a slot's diameter, the ✕'s, the margin kept from the screen's edges. */
    private static final float RADIUS = 104, SLOT = 40, DISCARD = 32, MARGIN = 10;
    /**
     * Degrees from the inward direction, top first: four targets 27° apart (40dp slots with 8dp between at this
     * radius), a 32° gap, the context pair. The arc leans up: under the handle is the column of held captures and ✕.
     */
    private static final float[] ANGLES = { 88, 61, 34, 7, -25, -52 };
    /** v2's popover motion: rise in on --ease-arrive over --duration-gentle, drop out on --ease-leave over --duration-quick. */
    private static final long OPEN_MS = 250, CLOSE_MS = 150, STAGGER_MS = 18, DICTATE_MS = 220;
    private static final int ICON = 0xffe8e9eb;

    private enum Mode { CLOSED, OPEN, DICTATING }

    private final Context context;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Dialog dialog;
    /** The full-screen window (the open arc), and the small one the dictation's row is handed to. */
    private final Surface surface;
    private final Surface[] rowSurfaces = new Surface[3];
    private final Dialog[] rowDialogs = new Dialog[3];
    private final FloatFrost frost;
    private final Drawable[] icons = new Drawable[SLOTS.length];
    private final Drawable cross;
    private final Paint names = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float[] slotX = new float[SLOTS.length], slotY = new float[SLOTS.length];
    private final PathInterpolator arrive = new PathInterpolator(.2f, .8f, .2f, 1f), leave = new PathInterpolator(.4f, 0f, 1f, 1f);
    private Mode mode = Mode.CLOSED;
    private boolean right, held, labels;
    private float anchorX, anchorY, discardX, discardY;
    /** 0 closed .. 1 open (time through the open or close motion); dictation 0 .. 1 as the targets leave. */
    private float shown, dictated;
    private boolean closing;
    private Slot chosen, pressed;
    private boolean pressedDiscard;
    private float downX, downY;
    private ValueAnimator motion, dictation;
    private Bitmap backdrop;
    private int originX, originY;
    private final int[] at = new int[2];
    private final float[] labelX = new float[SLOTS.length], labelY = new float[SLOTS.length],
        labelSize = new float[SLOTS.length], labelAlpha = new float[SLOTS.length];
    private int request;

    FloatRadial(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        // As bright as the handle, with its 1dp hairline.
        frost = new FloatFrost(-1, dp(1));
        frost.setLifted(true);
        for (Slot slot : SLOTS) {
            icons[slot.ordinal()] = context.getDrawable(slot.icon).mutate();
            icons[slot.ordinal()].setTint(ICON);
        }
        cross = context.getDrawable(R.drawable.float_cancel).mutate();
        cross.setTint(ICON);
        Typeface geist = androidx.core.content.res.ResourcesCompat.getFont(context, R.font.composer_geist);
        names.setTypeface(Build.VERSION.SDK_INT >= 28 ? Typeface.create(geist, 500, false) : geist);
        names.setTextSize(dp(12.5f));
        names.setColor(ICON);
        names.setShadowLayer(dp(6), 0, dp(1), 0xcc000000);
        surface = new Surface(context);
        for (int k = 0; k < 3; k++) rowSurfaces[k] = new Surface(context);
        dialog = overlay(surface);
        WindowManager.LayoutParams full = dialog.getWindow().getAttributes();
        full.x = full.y = 0;
        full.width = full.height = WindowManager.LayoutParams.MATCH_PARENT;
        dialog.getWindow().setAttributes(full);
        for (int k = 0; k < 3; k++) rowDialogs[k] = overlay(rowSurfaces[k]);
    }

    private Dialog overlay(Surface content) {
        Dialog dialog = new Dialog(context, R.style.ConduitFloatTheme);
        dialog.setCancelable(false);
        Window window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        window.setContentView(content);
        window.getDecorView().setPadding(0, 0, 0, 0);
        WindowManager.LayoutParams p = window.getAttributes();
        p.format = PixelFormat.TRANSLUCENT;
        p.gravity = Gravity.TOP | Gravity.LEFT;
        p.windowAnimations = 0;
        if (Build.VERSION.SDK_INT >= 28)
            p.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if (Build.VERSION.SDK_INT >= 30) p.setFitInsetsTypes(0);
        window.setAttributes(p);
        return dialog;
    }

    private void invalidateAll() { surface.invalidate(); for (Surface row : rowSurfaces) row.invalidate(); }

    private boolean rowShowing() { for (Dialog row : rowDialogs) if (row.isShowing()) return true; return false; }

    private void dismissRows() { for (Dialog row : rowDialogs) if (row.isShowing()) row.dismiss(); }

    private int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    boolean isOpen() { return mode == Mode.OPEN && !closing; }
    boolean isDictating() { return mode == Mode.DICTATING; }

    /**
     * Opens around the handle. right: Float sits on the right edge; centreX/centreY: the handle's centre in screen
     * pixels; screen: the whole screen in pixels; held: captures are held (the ✕ shows under their card at discardX/Y).
     */
    void open(boolean right, float centreX, float centreY, int screenWidth, int screenHeight, boolean held, float[] discardCentre) {
        if (mode == Mode.OPEN && !closing) return;
        cancelMotion();
        this.right = right;
        anchorX = centreX;
        anchorY = centreY;
        this.held = held;
        if (discardCentre != null) { discardX = discardCentre[0]; discardY = discardCentre[1]; }
        labels = ConduitFloatPlugin.preferences(context).getBoolean("slotNames", false);
        chosen = null;
        pressed = null;
        dictated = 0;
        layout(screenWidth, screenHeight);
        mode = Mode.OPEN;
        closing = false;
        shown = 0;
        // The frost's ground: the screen as it is now, before anything of the radial is on it.
        int ticket = ++request;
        ConduitScreenReader reader = ConduitScreenReader.instance;
        if (backdrop == null && reader != null && Build.VERSION.SDK_INT >= 30 && ConduitContext.screenReaderOn(context)) {
            final boolean[] done = { false };
            Runnable reveal = () -> { if (!done[0] && request == ticket) { done[0] = true; reveal(); } };
            main.postDelayed(reveal, 180);
            reader.backdrop(bitmap -> main.post(() -> {
                if (request != ticket || mode == Mode.CLOSED) { if (bitmap != null) bitmap.recycle(); return; }
                setBackdrop(bitmap);
                reveal.run();
            }));
        } else reveal();
    }

    private void reveal() {
        if (mode == Mode.CLOSED) return;
        if (!dialog.isShowing()) dialog.show();
        // Back from a dictation's row: the full window is up and drawing, so the row's can go.
        if (rowShowing()) surface.postOnAnimation(() -> { if (mode != Mode.DICTATING) dismissRows(); });
        if (mode == Mode.OPEN) animateShown(1, OPEN_MS);
    }

    private void setBackdrop(Bitmap next) {
        if (backdrop != null && backdrop != next) backdrop.recycle();
        backdrop = next;
        frost.setBackdrop(next);
        invalidateAll();
    }

    /** Captures came or went while open: the ✕ follows. */
    void setHeld(boolean held, float[] discardCentre) {
        this.held = held;
        if (discardCentre != null) { discardX = discardCentre[0]; discardY = discardCentre[1]; }
        invalidateAll();
    }

    /** Out of sight for a capture (a frame or two), then back exactly as it was. */
    void setHidden(boolean hidden) {
        if (dialog.isShowing()) surface.setVisibility(hidden ? View.INVISIBLE : View.VISIBLE);
        for (int k = 0; k < 3; k++) if (rowDialogs[k].isShowing()) rowSurfaces[k].setVisibility(hidden ? View.INVISIBLE : View.VISIBLE);
        // The screen changes under a screenshot's flash; the next open takes a fresh backdrop.
        if (!hidden && mode == Mode.CLOSED) setBackdrop(null);
    }

    /** The arc, turned away from the screen's top or bottom just enough that every slot stays on it. */
    private void layout(int width, int height) {
        float margin = dp(MARGIN) + dp(SLOT) / 2f;
        float towardMiddle = anchorY < height / 2f ? -1 : 1;
        for (float turn = 0; turn <= 80; turn += 4) {
            place(towardMiddle * turn);
            boolean fits = true;
            for (int i = 0; i < SLOTS.length; i++)
                if (slotY[i] < margin || slotY[i] > height - margin || slotX[i] < margin || slotX[i] > width - margin) fits = false;
            if (fits) return;
        }
    }

    /** turn: degrees the whole arc turns, positive toward the top. */
    private void place(float turn) {
        for (int i = 0; i < SLOTS.length; i++) {
            double a = Math.toRadians(ANGLES[i] + turn);
            float inward = right ? -1 : 1;
            slotX[i] = anchorX + inward * (float) Math.cos(a) * dp(RADIUS);
            slotY[i] = anchorY - (float) Math.sin(a) * dp(RADIUS);
        }
    }

    /**
     * jbot or New chat was chosen: the chosen slot flies into the pill's start (pillX, pillY: its target glyph), the
     * other targets shrink away, and Screenshot and Camera stay where they are for the dictation.
     */
    void dictate(Slot slot) {
        if (mode != Mode.OPEN) return;
        // From wherever each slot is this instant (the arc may still be opening): no jump to the arc first.
        for (int i = 0; i < SLOTS.length; i++) {
            float p = progress(i);
            startX[i] = anchorX + (slotX[i] - anchorX) * p;
            startY[i] = anchorY + (slotY[i] - anchorY) * p;
            startAlpha[i] = Math.min(1, p * 1.6f);
            startScale[i] = .7f + .3f * p;
        }
        // The dictation's row under the pill, beside the captures' column: the target (tap it to send elsewhere),
        // then Screenshot and Camera.
        float inward = right ? -1 : 1;
        for (int k = 0; k < 3; k++) { rowX[k] = anchorX + inward * dp(ROW_START + k * ROW_STEP); rowY[k] = anchorY + dp(ROW_DOWN); }
        cancelMotion();
        shown = 1;
        closing = false;
        mode = Mode.DICTATING;
        chosen = slot;
        targetIcon = null;
        dictation = ValueAnimator.ofFloat(0, 1);
        dictation.setDuration(DICTATE_MS);
        dictation.setInterpolator(new android.view.animation.LinearInterpolator());
        dictation.addUpdateListener(a -> { dictated = (float) a.getAnimatedValue(); invalidateAll(); });
        dictation.addListener(new android.animation.AnimatorListenerAdapter() {
            boolean cancelled;
            @Override public void onAnimationCancel(android.animation.Animator animation) { cancelled = true; }
            @Override public void onAnimationEnd(android.animation.Animator animation) { if (!cancelled) shrinkToContext(); }
        });
        dictation.start();
    }
    /** dp: the row's distance under the handle's centre, its first slot's from the handle's centre, the step. */
    private static final float ROW_DOWN = 50, ROW_START = 44, ROW_STEP = 48;
    private final float[] rowX = new float[3], rowY = new float[3];
    private final float[] startX = new float[SLOTS.length], startY = new float[SLOTS.length],
        startAlpha = new float[SLOTS.length], startScale = new float[SLOTS.length];

    /** The row position of slot i while dictating, or -1 when it has none (the targets not chosen). */
    private int rowOf(int i) {
        if (SLOTS[i] == chosen) return 0;
        if (SLOTS[i] == Slot.SCREENSHOT) return 1;
        if (SLOTS[i] == Slot.CAMERA) return 2;
        return -1;
    }

    /** Retargeted while dictating: the bubble shows the new target's icon. */
    void setTargetIcon(int icon) {
        targetIcon = context.getDrawable(icon).mutate();
        targetIcon.setTint(ICON);
        invalidateAll();
    }
    private Drawable targetIcon;

    /** Dictating: the window covers only Screenshot and Camera, so the rest of the screen is the app's again. */
    private void shrinkToContext() {
        if (mode != Mode.DICTATING) return;
        // Not a resize of the full window (the system moves a window a frame before it redraws, so they would jump):
        // each of the three goes to a small window of its own, and once those have drawn, the
        // full-screen one goes.
        int half = dp(SLOT) / 2 + dp(4);
        for (int k = 0; k < 3; k++) {
            Window window = rowDialogs[k].getWindow();
            WindowManager.LayoutParams p = window.getAttributes();
            p.x = Math.round(rowX[k]) - half; p.y = Math.round(rowY[k]) - half; p.width = p.height = 2 * half;
            window.setAttributes(p);
            rowSurfaces[k].setVisibility(View.VISIBLE);
            if (!rowDialogs[k].isShowing()) rowDialogs[k].show();
            rowSurfaces[k].invalidate();
        }
        Surface last = rowSurfaces[2];
        last.getViewTreeObserver().addOnDrawListener(new android.view.ViewTreeObserver.OnDrawListener() {
            boolean done;
            @Override public void onDraw() {
                if (done) return;
                done = true;
                last.post(() -> {
                    last.getViewTreeObserver().removeOnDrawListener(this);
                    last.postOnAnimation(() -> { if (mode == Mode.DICTATING && dialog.isShowing()) dialog.dismiss(); });
                });
            }
        });
    }

    /** Closes with the drop motion (from the open arc or the dictation's pair). */
    void close() {
        if (mode == Mode.CLOSED || closing) return;
        if (dictation != null) dictation.cancel();
        closing = true;
        pressed = null;
        animateShown(0, CLOSE_MS);
    }

    /** Gone this instant, with no fade: a panel takes the screen behind it next. */
    void hideNow() {
        cancelMotion();
        mode = Mode.CLOSED;
        closing = false;
        shown = 0;
        chosen = pressed = null;
        if (dialog.isShowing()) dialog.dismiss();
        dismissRows();
        surface.setVisibility(View.VISIBLE);
        for (Surface row : rowSurfaces) row.setVisibility(View.VISIBLE);
        setBackdrop(null);
    }

    void destroy() { hideNow(); }

    private void cancelMotion() {
        if (motion != null) { motion.cancel(); motion = null; }
        if (dictation != null) { dictation.cancel(); dictation = null; }
    }

    private void animateShown(float to, long ms) {
        if (motion != null) motion.cancel();
        float from = shown;
        motion = ValueAnimator.ofFloat(from, to);
        motion.setDuration(ms + STAGGER_MS * (SLOTS.length - 1));
        motion.setInterpolator(new android.view.animation.LinearInterpolator());
        motion.addUpdateListener(a -> { shown = (float) a.getAnimatedValue(); invalidateAll(); });
        motion.addListener(new android.animation.AnimatorListenerAdapter() {
            boolean cancelled;
            @Override public void onAnimationCancel(android.animation.Animator animation) { cancelled = true; }
            @Override public void onAnimationEnd(android.animation.Animator animation) {
                if (cancelled || to > 0) return;
                hideNow();
            }
        });
        motion.start();
    }

    /** How far slot i is through the open or close motion, eased; each slot on its own small delay. */
    private float progress(int i) {
        long total = (closing ? CLOSE_MS : OPEN_MS) + STAGGER_MS * (SLOTS.length - 1);
        float span = 1 - STAGGER_MS * (SLOTS.length - 1) / (float) total;
        float delay = STAGGER_MS * i / (float) total;
        float local = Math.max(0, Math.min(1, (shown - delay) / Math.max(.01f, span)));
        return closing ? 1 - leave.getInterpolation(1 - local) : arrive.getInterpolation(local);
    }

    private Slot slotAt(float x, float y) {
        float reach = dp(SLOT) / 2f + dp(6);
        for (int i = 0; i < SLOTS.length; i++) {
            if (mode == Mode.DICTATING) {
                int k = rowOf(i);
                if (k >= 0 && Math.hypot(x - rowX[k], y - rowY[k]) <= reach) return SLOTS[i];
                continue;
            }
            if (Math.hypot(x - slotX[i], y - slotY[i]) <= reach) return SLOTS[i];
        }
        return null;
    }

    private boolean onDiscard(float x, float y) {
        return held && mode == Mode.OPEN && Math.hypot(x - discardX, y - discardY) <= dp(DISCARD) / 2f + dp(6);
    }

    private boolean touch(MotionEvent event) {
        float x = event.getRawX(), y = event.getRawY();
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                if (closing || mode == Mode.CLOSED) return true;
                downX = x; downY = y;
                pressed = slotAt(x, y);
                pressedDiscard = pressed == null && onDiscard(x, y);
                if (pressed != null || pressedDiscard) surface.performHapticFeedback(Build.VERSION.SDK_INT >= 27
                    ? HapticFeedbackConstants.TEXT_HANDLE_MOVE : HapticFeedbackConstants.CLOCK_TICK);
                invalidateAll();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (Math.hypot(x - downX, y - downY) > ViewConfiguration.get(context).getScaledTouchSlop() * 2) {
                    if (pressed != null || pressedDiscard) { pressed = null; pressedDiscard = false; invalidateAll(); }
                }
                return true;
            case MotionEvent.ACTION_UP: {
                Slot tapped = pressed != null && pressed == slotAt(x, y) ? pressed : null;
                boolean discard = pressedDiscard && onDiscard(x, y);
                boolean moved = Math.hypot(x - downX, y - downY) > ViewConfiguration.get(context).getScaledTouchSlop() * 2;
                pressed = null;
                pressedDiscard = false;
                invalidateAll();
                if (closing || mode == Mode.CLOSED) return true;
                if (tapped != null && mode == Mode.DICTATING && tapped == chosen) listener.retarget();
                else if (tapped != null) {
                    if (tapped.target() && tapped != Slot.JBOT && tapped != Slot.NEW_CHAT) hideNow();
                    listener.chosen(tapped);
                } else if (discard) listener.discard();
                else if (mode == Mode.OPEN && !moved) { close(); listener.dismissed(); }
                return true;
            }
            case MotionEvent.ACTION_CANCEL: pressed = null; pressedDiscard = false; invalidateAll(); return true;
            default: return true;
        }
    }

    private void paint(Canvas canvas, View on) {
        if (mode == Mode.CLOSED) return;
        canvas.save();
        // Everything is placed in screen pixels; each window draws its own part of the screen.
        on.getLocationOnScreen(at);
        canvas.translate(-at[0], -at[1]);
        int size = dp(SLOT);
        float dictateIn = arrive.getInterpolation(Math.min(1, dictated)), dictateOut = leave.getInterpolation(Math.min(1, dictated));
        java.util.Arrays.fill(labelAlpha, 0);
        for (int i = 0; i < SLOTS.length; i++) {
            float p = progress(i);
            float x = anchorX + (slotX[i] - anchorX) * p, y = anchorY + (slotY[i] - anchorY) * p;
            float alpha = Math.min(1, p * 1.6f), scale = .7f + .3f * p;
            if (mode == Mode.DICTATING) {
                int k = rowOf(i);
                x = startX[i]; y = startY[i]; alpha = startAlpha[i]; scale = startScale[i];
                // Closing from the dictation's row: they fade where they are (the row's window is only that big).
                float fade = closing ? shown : 1;
                if (k >= 0) {
                    // Into the row under the pill, on the rise curve, coming up to full as it goes.
                    x += (rowX[k] - x) * dictateIn;
                    y += (rowY[k] - y) * dictateIn;
                    alpha += (1 - alpha) * dictateIn;
                    scale += (1 - scale) * dictateIn;
                    alpha *= fade;
                } else {
                    scale *= 1 - .6f * dictateOut;
                    alpha *= 1 - dictateOut;
                    if (alpha <= .01f) continue;
                }
            }
            if (SLOTS[i] == pressed) scale *= .92f;
            if (mode == Mode.DICTATING && SLOTS[i] == chosen && targetIcon != null) {
                drawRound(canvas, x, y, size * scale, alpha, SLOTS[i] == pressed);
                drawIcon(canvas, targetIcon, x, y, size * scale * .45f, alpha);
            } else drawSlot(canvas, i, x, y, size * scale, alpha, SLOTS[i] == pressed);
            labelX[i] = x; labelY[i] = y; labelSize[i] = size; labelAlpha[i] = alpha;
        }
        // Names after every slot, so none lies under a neighbour's bubble.
        for (int i = 0; i < SLOTS.length && labels; i++) {
            float x = labelX[i], y = labelY[i], slot = labelSize[i], alpha = labelAlpha[i];
            if (alpha > .01f && mode != Mode.DICTATING) {
                names.setAlpha(Math.round(255 * alpha * .92f));
                // Outward along the slot's own direction from the handle, so a name never lies over its neighbour.
                float w = names.measureText(SLOTS[i].label), dx = x - anchorX, dy = y - anchorY;
                float len = Math.max(1, (float) Math.hypot(dx, dy)), ux = dx / len, uy = dy / len;
                float reach = slot / 2f + dp(7), px = x + ux * reach, py = y + uy * reach;
                float half = (names.descent() - names.ascent()) / 2;
                float tx = Math.abs(ux) < .35f ? px - w / 2 : ux > 0 ? px : px - w;
                float ty = py + uy * half - (names.ascent() + names.descent()) / 2;
                canvas.drawText(SLOTS[i].label, tx, ty, names);
            }
        }
        if (held && mode == Mode.OPEN) {
            float p = progress(0);
            float d = dp(DISCARD) * (.7f + .3f * p) * (pressedDiscard ? .92f : 1);
            drawRound(canvas, discardX, discardY, d, Math.min(1, p * 1.6f), pressedDiscard);
            drawIcon(canvas, cross, discardX, discardY, dp(13), Math.min(1, p * 1.6f));
        }
        canvas.restore();
    }

    private void drawSlot(Canvas canvas, int i, float x, float y, float size, float alpha, boolean pressed) {
        drawRound(canvas, x, y, size, alpha, pressed);
        float icon = size * (SLOTS[i] == Slot.JBOT ? .5f : .45f);
        drawIcon(canvas, icons[i], x, y, icon, alpha);
    }

    private final Paint wash = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint shadow = new Paint(Paint.ANTI_ALIAS_FLAG);

    private void drawRound(Canvas canvas, float x, float y, float size, float alpha, boolean pressed) {
        int a = Math.round(255 * alpha);
        // The popover's lift, 0 8 32 at 10%, as a soft disc under the frost.
        shadow.setColor(Color.argb(Math.round(a * .18f), 0, 0, 0));
        shadow.setMaskFilter(new android.graphics.BlurMaskFilter(dp(10), android.graphics.BlurMaskFilter.Blur.NORMAL));
        canvas.drawCircle(x, y + dp(4), size / 2f, shadow);
        frost.setBounds(Math.round(x - size / 2), Math.round(y - size / 2), Math.round(x + size / 2), Math.round(y + size / 2));
        frost.setAlpha(a);
        frost.draw(canvas);
        if (pressed) {
            wash.setColor(Color.argb(Math.round(a * .14f), 255, 255, 255));
            canvas.drawCircle(x, y, size / 2f, wash);
        }
    }

    private void drawIcon(Canvas canvas, Drawable icon, float x, float y, float size, float alpha) {
        icon.setBounds(Math.round(x - size / 2), Math.round(y - size / 2), Math.round(x + size / 2), Math.round(y + size / 2));
        icon.setAlpha(Math.round(255 * alpha));
        icon.draw(canvas);
    }

    private final class Surface extends View {
        Surface(Context context) { super(context); setLayerType(LAYER_TYPE_HARDWARE, null); }
        @Override protected void onDraw(Canvas canvas) { paint(canvas, this); }
        @Override public boolean onTouchEvent(MotionEvent event) { return touch(event); }
    }
}
