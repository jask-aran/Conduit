package com.jaskaran.conduit;

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
import android.graphics.Typeface;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import java.util.ArrayList;
import java.util.List;

/** A touchable window: an untouchable overlay is capped at 80% opacity. */
final class FloatCaptures {
    /** dp. */
    static final float W = 32, H = 44, GAP = 8, PAD = 10;
    private static final float RADIUS = 9;
    /** dp. */
    static final float PEEK = 4, PEEK_INSET = 3;

    private final Context context;
    private final Dialog dialog;
    private final Card card;
    private final List<Bitmap> thumbs = new ArrayList<>();
    private boolean right;
    private int cardLeft, cardTop;

    FloatCaptures(Context context, Runnable tapped) {
        this.context = context;
        card = new Card(context, tapped);
        dialog = new Dialog(context, R.style.ConduitFloatTheme);
        dialog.setCancelable(false);
        Window window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        window.setContentView(card);
        window.getDecorView().setPadding(0, 0, 0, 0);
        WindowManager.LayoutParams p = window.getAttributes();
        p.format = PixelFormat.TRANSLUCENT;
        p.gravity = Gravity.TOP | Gravity.LEFT;
        p.width = dp(W + 2 * PAD);
        p.height = dp(H + 2 * PAD);
        p.windowAnimations = 0;
        if (Build.VERSION.SDK_INT >= 28)
            p.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if (Build.VERSION.SDK_INT >= 30) p.setFitInsetsTypes(0);
        window.setAttributes(p);
    }

    private int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    static Rect cardRect(Context context, float[] handleCentre, float handleHeight) {
        float d = context.getResources().getDisplayMetrics().density;
        int left = Math.round(handleCentre[0] - W * d / 2), top = Math.round(handleCentre[1] + handleHeight / 2 + GAP * d);
        return new Rect(left, top, left + Math.round(W * d), top + Math.round(H * d));
    }

    static float[] discardCentre(Context context, Rect card, int held) {
        float d = context.getResources().getDisplayMetrics().density;
        int peeks = Math.max(0, Math.min(2, held - 1));
        return new float[] { card.exactCenterX(), card.bottom + peeks * PEEK * d + GAP * d + 12 * d };
    }

    void show(List<Bitmap> next, boolean right, Rect at) {
        thumbs.clear();
        thumbs.addAll(next);
        this.right = right;
        if (thumbs.isEmpty()) { hide(); return; }
        cardLeft = at.left;
        cardTop = at.top;
        card.animate().cancel();
        Window window = dialog.getWindow();
        WindowManager.LayoutParams p = window.getAttributes();
        p.x = cardLeft - dp(PAD);
        p.y = cardTop - dp(PAD);
        window.setAttributes(p);
        card.setAlpha(1);
        card.setTranslationY(0);
        card.setScaleX(1);
        card.setScaleY(1);
        card.invalidate();
        if (!dialog.isShowing()) {
            dialog.show();
            card.setAlpha(0);
            card.setScaleX(.8f);
            card.setScaleY(.8f);
            card.animate().alpha(1).scaleX(1).scaleY(1).setDuration(200)
                .setInterpolator(new android.view.animation.PathInterpolator(.2f, .8f, .2f, 1)).start();
        }
    }

    void setHidden(boolean hidden) {
        if (!dialog.isShowing()) return;
        card.animate().cancel();
        if (hidden) { card.setVisibility(View.INVISIBLE); return; }
        if (card.getVisibility() == View.VISIBLE) return;
        card.setAlpha(0);
        card.setVisibility(View.VISIBLE);
        card.animate().alpha(1).setDuration(180).start();
    }

    void sendAway() {
        if (!dialog.isShowing()) return;
        card.animate().translationY(-dp(H)).scaleX(.6f).scaleY(.6f).alpha(0).setDuration(260)
            .setInterpolator(new android.view.animation.PathInterpolator(.4f, 0, 1, 1)).withEndAction(this::hide).start();
    }

    void hide() {
        card.animate().cancel();
        if (dialog.isShowing()) dialog.dismiss();
        card.setVisibility(View.VISIBLE);
    }

    private final class Card extends View {
        private final Runnable tapped;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint chip = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint digits = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path clip = new Path();
        private final RectF box = new RectF();
        private final Rect source = new Rect();

        Card(Context context, Runnable tapped) {
            super(context);
            this.tapped = tapped;
            line.setStyle(Paint.Style.STROKE);
            line.setStrokeWidth(Math.max(1, dp(.8f)));
            line.setColor(0x4dffffff);
            shade.setColor(0x66000000);
            shade.setMaskFilter(new android.graphics.BlurMaskFilter(dp(4), android.graphics.BlurMaskFilter.Blur.NORMAL));
            chip.setColor(0xffe8e9eb);
            digits.setColor(0xff131216);
            digits.setTextSize(dp(9.5f));
            Typeface mono = androidx.core.content.res.ResourcesCompat.getFont(context, R.font.float_paper_mono);
            digits.setTypeface(mono);
            setContentDescription("Held screenshots and photos");
        }

        @Override protected void onDraw(Canvas canvas) {
            int n = Math.min(3, thumbs.size());
            float pad = dp(PAD), w = dp(W), h = dp(H), r = dp(RADIUS);
            for (int k = n - 1; k >= 0; k--) {
                Bitmap bitmap = thumbs.get(thumbs.size() - 1 - k);
                canvas.save();
                float inset = dp(PEEK_INSET) * k;
                canvas.translate(pad, pad + dp(PEEK) * k);
                box.set(inset, 0, w - inset, h);
                canvas.drawRoundRect(box.left, box.top + dp(2), box.right, box.bottom + dp(2), r, r, shade);
                clip.reset();
                clip.addRoundRect(box, r, r, Path.Direction.CW);
                canvas.save();
                canvas.clipPath(clip);
                if (bitmap != null && !bitmap.isRecycled()) {
                    float scale = Math.max(w / bitmap.getWidth(), h / bitmap.getHeight());
                    int sw = Math.round(w / scale), sh = Math.round(h / scale);
                    int sx = (bitmap.getWidth() - sw) / 2, sy = (bitmap.getHeight() - sh) / 2;
                    source.set(sx, sy, sx + sw, sy + sh);
                    paint.setAlpha(k == 0 ? 255 : k == 1 ? 210 : 160);
                    canvas.drawBitmap(bitmap, source, box, paint);
                } else {
                    paint.setColor(0xff3b3a3d);
                    canvas.drawRect(box, paint);
                }
                canvas.restore();
                box.inset(line.getStrokeWidth() / 2, line.getStrokeWidth() / 2);
                canvas.drawRoundRect(box, r, r, line);
                canvas.restore();
            }
            if (thumbs.size() > 1) {
                String count = String.valueOf(thumbs.size());
                float tw = digits.measureText(count), ch = dp(15), cw = Math.max(ch, tw + dp(8));
                float cx = right ? pad + dp(1) : pad + w - dp(1), cy = pad + dp(1);
                box.set(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2);
                canvas.drawRoundRect(box, ch / 2, ch / 2, chip);
                canvas.drawText(count, cx - tw / 2, cy - (digits.ascent() + digits.descent()) / 2, digits);
            }
        }

        private float downX, downY;
        @Override public boolean onTouchEvent(MotionEvent event) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) { downX = event.getRawX(); downY = event.getRawY(); return true; }
            if (event.getActionMasked() == MotionEvent.ACTION_UP
                && Math.hypot(event.getRawX() - downX, event.getRawY() - downY) < dp(12)) { performClick(); return true; }
            return true;
        }

        @Override public boolean performClick() { super.performClick(); tapped.run(); return true; }
    }
}
