package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.app.Dialog;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Build;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;

/**
 * A capture lands: a soft white flash over the whole screen (peaking at 22% in the first 180ms, as the system
 * screenshot does), and a copy of what was taken shrinking from the full screen into the card under Float's handle on
 * the rise curve, its corners rounding as it goes. 480ms in all, then a tick. Main thread only.
 */
final class FloatShot {
    private static final long FLASH_MS = 180, FLY_DELAY = 60, FLY_MS = 420;
    private final Context context;
    private final PathInterpolator rise = new PathInterpolator(.2f, .8f, .2f, 1f);
    private final java.util.List<ValueAnimator> motions = new java.util.ArrayList<>();
    private final java.util.List<Dialog> dialogs = new java.util.ArrayList<>();

    FloatShot(Context context) { this.context = context; }

    private int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    /** Plays over everything; bitmap may be null (the flash only). done runs once the copy has landed. */
    void play(Bitmap bitmap, boolean flash, Rect card, Runnable done) {
        Dialog dialog = new Dialog(context, R.style.ConduitFloatTheme);
        dialogs.add(dialog);
        dialog.setCancelable(false);
        Window window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        // Touchable for its half second: an untouchable overlay is capped at 80% opacity, and the copy must be solid.
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        final float[] t = { 0 };
        View view = new View(context) {
            private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            private final Paint white = new Paint();
            private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
            private final Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
            private final RectF box = new RectF();
            private final Path clip = new Path();
            {
                line.setStyle(Paint.Style.STROKE);
                line.setStrokeWidth(Math.max(1, dp(.8f)));
                line.setColor(0x4dffffff);
                shade.setMaskFilter(new android.graphics.BlurMaskFilter(dp(20), android.graphics.BlurMaskFilter.Blur.NORMAL));
            }
            @Override protected void onDraw(Canvas canvas) {
                float ms = t[0];
                int w = getWidth(), h = getHeight();
                if (bitmap != null && !bitmap.isRecycled()) {
                    float p = rise.getInterpolation(Math.max(0, Math.min(1, (ms - FLY_DELAY) / FLY_MS)));
                    box.set(card.left * p, card.top * p, w + (card.right - w) * p, h + (card.bottom - h) * p);
                    float r = dp(28) + (dp(9) - dp(28)) * p;
                    shade.setColor(Color.argb(Math.round(120 * p), 0, 0, 0));
                    canvas.drawRoundRect(box.left, box.top + dp(6) * (1 - p), box.right, box.bottom + dp(6) * (1 - p), r, r, shade);
                    clip.reset();
                    clip.addRoundRect(box, r, r, Path.Direction.CW);
                    canvas.save();
                    canvas.clipPath(clip);
                    canvas.drawBitmap(bitmap, null, box, paint);
                    canvas.restore();
                    canvas.drawRoundRect(box, r, r, line);
                }
                if (flash && ms < FLASH_MS) {
                    float f = ms / FLASH_MS, a = f < .35f ? f / .35f : 1 - (f - .35f) / .65f;
                    white.setColor(Color.argb(Math.round(255 * .22f * a), 255, 255, 255));
                    canvas.drawRect(0, 0, w, h, white);
                }
            }
        };
        window.setContentView(view);
        window.getDecorView().setPadding(0, 0, 0, 0);
        WindowManager.LayoutParams p = window.getAttributes();
        p.format = PixelFormat.TRANSLUCENT;
        p.gravity = Gravity.TOP | Gravity.LEFT;
        p.x = p.y = 0;
        p.width = p.height = WindowManager.LayoutParams.MATCH_PARENT;
        p.windowAnimations = 0;
        if (Build.VERSION.SDK_INT >= 28)
            p.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if (Build.VERSION.SDK_INT >= 30) p.setFitInsetsTypes(0);
        window.setAttributes(p);
        dialog.show();
        view.setAlpha(0);
        long total = bitmap != null ? FLY_DELAY + FLY_MS : FLASH_MS;
        ValueAnimator motion = ValueAnimator.ofFloat(0, total);
        motions.add(motion);
        motion.setDuration(total);
        motion.setInterpolator(new android.view.animation.LinearInterpolator());
        motion.addUpdateListener(a -> { t[0] = (float) a.getAnimatedValue(); view.invalidate(); });
        motion.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator animation) {
                motions.remove(motion);
                view.performHapticFeedback(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY);
                done.run();
                // One frame with the card underneath drawn before this goes, so there is no gap.
                view.postOnAnimation(() -> { dialog.dismiss(); dialogs.remove(dialog); });
            }
        });
        // From the window's first drawn frame: started before it is up, the flash's peak would be spent unseen.
        view.getViewTreeObserver().addOnDrawListener(new android.view.ViewTreeObserver.OnDrawListener() {
            boolean started;
            @Override public void onDraw() {
                if (started) return;
                started = true;
                view.post(() -> {
                    view.getViewTreeObserver().removeOnDrawListener(this);
                    if (!motions.contains(motion)) return;
                    view.setAlpha(1);
                    motion.start();
                });
            }
        });
    }

    /** Cancelling must not call done, including from an animation waiting for its first frame. */
    void cancel() {
        for (ValueAnimator motion : motions) {
            motion.removeAllListeners();
            motion.cancel();
        }
        motions.clear();
        for (Dialog dialog : dialogs) dialog.dismiss();
        dialogs.clear();
    }
}
