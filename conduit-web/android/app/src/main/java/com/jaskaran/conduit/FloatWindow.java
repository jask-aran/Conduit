package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.text.TextPaint;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.view.WindowInsets;
import android.view.WindowMetrics;

import com.jaskaran.conduit.FloatMachine.State;

final class FloatWindow {
    interface Listener {
        void onShown();
        void onRefresh();
        void onVisibilityChanged();
        void onPlacementChanged();
    }
    private final Context context;
    private final Handler main;
    private final Listener listener;
    private State state = State.HANDLE;
    private final TextPaint widthText = new TextPaint();
    private String errorText = "Couldn't send — open Conduit";
    private boolean destroyed;
    private int availableWidth, availableHeight;
    private ValueAnimator snap;
    private final WindowManager windows;
    private WindowManager.LayoutParams position;
    private FloatView control;
    private Dialog overlay;
    private Window overlayWindow;
    private final GradientDrawable frost = new GradientDrawable() {
        @Override public void getOutline(Outline outline) {
            super.getOutline(outline);
            outline.setAlpha(1); // The translucent stroke must not suppress the lift shadow.
        }
    };
    private FloatFrost glass;
    private java.util.function.Consumer<Boolean> blurListener;
    private boolean blurEnabled;
    private ValueAnimator morph;
    int frameWidth, frameHeight;
    float openness;

    FloatWindow(Context context, Handler main, Listener listener) {
        this.context = context;
        this.main = main;
        this.listener = listener;
        windows = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    SharedPreferences prefs() { return ConduitFloatPlugin.preferences(context); }
    int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    void create(State state, FloatView.Listener actions) {
        this.state = state;
        control = new FloatView(context, this, actions, state);
        control.addOnLayoutChangeListener((view, l, t, r, b, ol, ot, or, ob) -> view.post(this::handleCentre));
        // A Dialog supplies the public Window background-blur API to this service overlay.
        overlay = new Dialog(context, R.style.ConduitFloatTheme);
        overlay.setCancelable(false);
        overlayWindow = overlay.getWindow();
        overlayWindow.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        overlayWindow.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        overlayWindow.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        overlayWindow.setBackgroundDrawable(frost);
        overlayWindow.setContentView(control);
        View decor = overlayWindow.getDecorView();
        decor.setPadding(0, 0, 0, 0);
        decor.setElevation(dp(8));
        if (Build.VERSION.SDK_INT >= 28) {
            decor.setOutlineAmbientShadowColor(0x1a000000);
            decor.setOutlineSpotShadowColor(0x1a000000);
        }
        // Over Samsung's live blur the handle is drawn as the radial's own slot, so open it reads as one of them.
        glass = new FloatFrost(-1, Math.max(1, dp(1)));
        glass.setLifted(true);
        glass.setLive(true);
        live = FloatLiveBlur.frost(overlayWindow, control, glass);
        position = overlayWindow.getAttributes();
        position.format = PixelFormat.TRANSLUCENT;
        if (Build.VERSION.SDK_INT >= 30) {
            position.setFitInsetsTypes(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            position.setFitInsetsIgnoringVisibility(true);
        }
        place();
        frameWidth = controlWidth();
        frameHeight = controlHeight();
        openness = state == State.HANDLE ? 0 : 1;
        updateFrame();
        overlay.show();
        listener.onShown();
        if (Build.VERSION.SDK_INT >= 31) {
            blurListener = enabled -> { blurEnabled = enabled; updateFrost(); };
            windows.addCrossWindowBlurEnabledListener(main::post, blurListener);
            blurEnabled = windows.isCrossWindowBlurEnabled();
            updateFrost();
        }
        control.setOnApplyWindowInsetsListener((view, insets) -> {
            view.post(() -> {
                if (!destroyed && updateBounds()) { place(); listener.onRefresh(); }
            });
            return insets;
        });
    }

    void setVisible(boolean visible) {
        if (overlayWindow == null) return;
        if (!visible && control != null) handleCentre(); // reads the window's offset while it can
        overlayWindow.getDecorView().setVisibility(visible ? View.VISIBLE : View.GONE);
    }

    void updateLevel(float loud) { control.updateLevel(loud); }

    void setGathered(int count) { if (control != null) control.setGathered(count); }

    void performHapticFeedback() {
        if (control != null) control.performHapticFeedback(Build.VERSION.SDK_INT >= 30
            ? android.view.HapticFeedbackConstants.CONFIRM : android.view.HapticFeedbackConstants.LONG_PRESS);
    }

    void setTarget(int icon, String name) { if (control != null) control.setTarget(icon, name); }

    float handleHeight() { return dp(HANDLE_H); }

    int top() { return position.y; }

    void refreshPlacement() { place(); listener.onRefresh(); }

    void showCaption(ConduitFloatCaption caption, String text, String to) {
        caption.show(text, to, prefs().getBoolean("right", true), dp(EDGE), position.y, controlHeight(), availableHeight, blurEnabled);
    }

    private boolean updateBounds() {
        int width = context.getResources().getDisplayMetrics().widthPixels;
        int height = context.getResources().getDisplayMetrics().heightPixels;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowMetrics metrics = windows.getCurrentWindowMetrics();
            android.graphics.Insets insets = metrics.getWindowInsets().getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            width = metrics.getBounds().width() - insets.left - insets.right;
            height = metrics.getBounds().height() - insets.top - insets.bottom;
        } else if (control != null && control.isAttachedToWindow()) {
            Rect frame = new Rect();
            control.getWindowVisibleDisplayFrame(frame);
            width = frame.width();
            height = frame.height();
        }
        width = Math.max(1, width);
        height = Math.max(1, height);
        boolean changed = width != availableWidth || height != availableHeight;
        availableWidth = width;
        availableHeight = height;
        return changed;
    }

    int controlWidth() {
        // The pill: 4 + 36 (cancel) + 6 + 56 (level) + 6 + 36 (send) + 4. At rest, a 44dp bubble.
        float width = PILL;
        if (state == State.HANDLE) width = HANDLE_W;
        else if (sending()) width = SENDING;
        else if (state == State.ERROR) {
            widthText.setTextSize(dp(13));
            width = Math.max(PILL, Math.min(304, 4 + 36 + 10 + 12 + widthText.measureText(errorText) / context.getResources().getDisplayMetrics().density));
        }
        return Math.min(availableWidth, dp(width));
    }

    int controlHeight() { return Math.min(availableHeight, dp(state == State.HANDLE ? HANDLE_H : sending() ? SENDING : 44)); }
    private boolean sending() { return state == State.STOPPING || state == State.SENDING || state == State.SENT; }
    private static final float SENDING = 40;
    /** dp. */
    static final float PILL = 148, EDGE = 6;
    private static final float REST_ALPHA = .42f;
    private boolean touched;
    static final float HANDLE_W = 32, HANDLE_H = 40;

    private void place() {
        if (snap != null) { snap.cancel(); snap = null; }
        updateBounds();
        position.gravity = Gravity.TOP | (prefs().getBoolean("right", true) ? Gravity.RIGHT : Gravity.LEFT);
        position.x = dp(EDGE);
        position.y = Math.round(Math.max(0, availableHeight - controlHeight())
            * Math.max(0, Math.min(1, prefs().getFloat("y", .45f))));
    }

    private boolean live;

    private void updateFrost() {
        if (destroyed) return;
        boolean right = prefs().getBoolean("right", true);
        float r = Math.min(frameWidth, frameHeight) / 2f;
        // Always fully round (a bubble at rest, a pill open): the window's blur follows a uniform outline.
        if (live) FloatLiveBlur.apply(overlayWindow.getDecorView(), FloatLiveBlur.radius(context), FloatLiveBlur.LIFT, r);
        boolean blurred = blurEnabled;
        frost.setCornerRadii(null);
        frost.setCornerRadius(r);
        // Over Samsung's live blur the ground is the blur's own tint, so only the white fill is drawn.
        frost.setColor(live ? 0x2bffffff : androidx.core.graphics.ColorUtils.compositeColors(0x2bffffff,
            blurred ? 0xe63a3b3f : 0xfa3a3b3f));
        frost.setStroke(dp(1), 0x4dffffff);
        if (Build.VERSION.SDK_INT >= 31) overlayWindow.setBackgroundBlurRadius(blurred ? Math.round(dp(24) * openness) : 0);
        control.invalidate();
    }

    private void updateFrame() {
        position.width = frameWidth;
        position.height = frameHeight;
        View decor = overlayWindow.getDecorView();
        decor.animate().cancel();
        decor.setAlpha(touched || attention ? 1 : REST_ALPHA + (1 - REST_ALPHA) * openness);
        overlayWindow.setAttributes(position);
        updateFrost();
        control.requestLayout();
    }

    void show(State next, String errorText, long sentAt) {
        if (destroyed) return;
        if (morph != null) { morph.cancel(); morph = null; }
        state = next;
        this.errorText = errorText;
        if (next != State.HANDLE) touched = false;
        control.show(next, errorText, sentAt);
        listener.onVisibilityChanged();
        int startY = position.y;
        place();
        int targetY = position.y;
        listener.onPlacementChanged();
        int startWidth = frameWidth, startHeight = frameHeight;
        int targetWidth = controlWidth(), targetHeight = controlHeight();
        float startOpen = openness, targetOpen = next == State.HANDLE ? 0 : 1;
        if (startWidth == targetWidth && startHeight == targetHeight) {
            openness = targetOpen;
            updateFrame();
            return;
        }
        morph = ValueAnimator.ofFloat(0, 1);
        morph.setDuration(220);
        morph.setInterpolator(new android.view.animation.PathInterpolator(.2f, 0f, 0f, 1f));
        morph.addUpdateListener(animation -> {
            float progress = (float) animation.getAnimatedValue();
            frameWidth = Math.round(startWidth + (targetWidth - startWidth) * progress);
            frameHeight = Math.round(startHeight + (targetHeight - startHeight) * progress);
            position.y = Math.round(startY + (targetY - startY) * progress);
            openness = startOpen + (targetOpen - startOpen) * progress;
            updateFrame();
        });
        morph.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator animation) {
                if (morph != animation) return;
                morph = null;
                overlayWindow.getDecorView().setAlpha(state != State.HANDLE || touched || attention ? 1 : REST_ALPHA);
            }
        });
        morph.start();
    }

    void lift(boolean held) {
        if (touched == held || (held && state != State.HANDLE)) return;
        touched = held;
        if (state != State.HANDLE || morph != null) return;
        overlayWindow.getDecorView().animate().alpha(held || attention ? 1 : REST_ALPHA).setDuration(held ? 90 : 260).start();
    }

    private boolean attention;
    void setAttention(boolean next) {
        if (attention == next) return;
        attention = next;
        if (state != State.HANDLE || morph != null || overlayWindow == null) return;
        overlayWindow.getDecorView().animate().alpha(attention || touched ? 1 : REST_ALPHA).setDuration(attention ? 90 : 260).start();
    }

    void snapToEdge() {
        boolean right = position.x + control.getWidth() / 2f > availableWidth / 2f;
        prefs().edit().putBoolean("right", right)
            .putFloat("y", position.y / (float) Math.max(1, availableHeight - controlHeight())).apply();
        if (right) position.x = Math.max(0, availableWidth - control.getWidth() - position.x);
        position.gravity = Gravity.TOP | (right ? Gravity.RIGHT : Gravity.LEFT);
        updateFrost();
        snap = ValueAnimator.ofInt(position.x, dp(EDGE));
        snap.setDuration(180);
        snap.setInterpolator(new DecelerateInterpolator());
        snap.addUpdateListener(animation -> {
            position.x = (int) animation.getAnimatedValue();
            overlayWindow.setAttributes(position);
        });
        snap.start();
    }

    float[] handleCentre() {
        boolean right = prefs().getBoolean("right", true);
        float half = dp(HANDLE_W) / 2f;
        // From the window's own place, which holds while it is hidden (GONE, for a capture or Only on side key) and
        // before it is laid out; the offset of that place from the screen's top is read whenever it is on screen.
        if (control.isShown() && control.getWidth() > 0) {
            int[] at = new int[2];
            control.getLocationOnScreen(at);
            offsetX = at[0] - windowLeft(right);
            offsetY = at[1] - position.y;
            measured = true;
        } else guessOffset();
        float left = offsetX + windowLeft(right);
        return new float[] { right ? left + frameWidth - half : left + half, offsetY + position.y + frameHeight / 2f };
    }

    /** The handle's window's top on screen less its y (the status bar's room, when the window fits under it). */
    private int offsetX, offsetY;
    private boolean measured;
    /** Before the handle has been on screen: its window fits inside the system bars and cutout, so it starts there. */
    private void guessOffset() {
        if (measured || Build.VERSION.SDK_INT < 30) return;
        android.graphics.Insets bars = windows.getCurrentWindowMetrics().getWindowInsets()
            .getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        offsetX = bars.left;
        offsetY = bars.top;
    }
    private int windowLeft(boolean right) { return right ? availableWidth - frameWidth - position.x : position.x; }

    int[] screenSize() {
        if (Build.VERSION.SDK_INT >= 30) {
            Rect bounds = windows.getCurrentWindowMetrics().getBounds();
            return new int[] { bounds.width(), bounds.height() };
        }
        android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
        windows.getDefaultDisplay().getRealMetrics(metrics);
        return new int[] { metrics.widthPixels, metrics.heightPixels };
    }

    boolean right() { return prefs().getBoolean("right", true); }

    void startDrag() { if (snap != null) { snap.cancel(); snap = null; } }

    int left() {
        return (position.gravity & Gravity.HORIZONTAL_GRAVITY_MASK) == Gravity.RIGHT
            ? availableWidth - control.getWidth() - position.x : position.x;
    }

    void dragTo(int x, int y) {
        position.x = Math.max(0, Math.min(availableWidth - control.getWidth(), x));
        position.y = Math.max(0, Math.min(availableHeight - control.getHeight(), y));
        position.gravity = Gravity.TOP | Gravity.LEFT;
        overlayWindow.setAttributes(position);
    }

    void stopAnimations() {
        destroyed = true;
        if (snap != null) snap.cancel();
        if (morph != null) morph.cancel();
        if (Build.VERSION.SDK_INT >= 31 && blurListener != null) windows.removeCrossWindowBlurEnabledListener(blurListener);
    }

    void dismiss() {
        if (overlay != null) overlay.dismiss();
    }
}
