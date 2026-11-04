package com.jaskaran.conduit;

import android.app.Dialog;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;

/**
 * The ✕ beside Float's handle while it holds captures for the next message: a small frost bubble, inward of the
 * handle at its middle. A tap discards them and ends the flow. Its own window, so it takes taps without widening the
 * handle's.
 */
final class FloatDiscard {
    private static final float SIZE = 30, GAP = 6;
    private final Context context;
    private final Dialog dialog;
    private final FloatFrost frost;

    FloatDiscard(Context context, Runnable discard) {
        this.context = context;
        ImageView icon = new ImageView(context);
        icon.setImageResource(R.drawable.float_cancel);
        icon.setImageTintList(ColorStateList.valueOf(0xffe8e9eb));
        icon.setScaleType(ImageView.ScaleType.CENTER);
        icon.setContentDescription("Discard screenshots and photos");
        icon.setOnClickListener(view -> discard.run());
        frost = new FloatFrost(-1, dp(.8f));
        dialog = new Dialog(context, R.style.ConduitFloatTheme);
        dialog.setCancelable(false);
        Window window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setBackgroundDrawable(frost);
        window.setContentView(icon);
        window.getDecorView().setPadding(0, 0, 0, 0);
        WindowManager.LayoutParams p = window.getAttributes();
        p.format = PixelFormat.TRANSLUCENT;
        p.gravity = Gravity.TOP | Gravity.LEFT;
        p.width = p.height = dp(SIZE);
        p.windowAnimations = 0;
        if (Build.VERSION.SDK_INT >= 30) p.setFitInsetsTypes(0);
        window.setAttributes(p);
    }

    private int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    /** Beside the handle (centre in screen pixels), on its inward side. */
    void show(boolean right, float[] handleCentre) {
        Window window = dialog.getWindow();
        WindowManager.LayoutParams p = window.getAttributes();
        float half = dp(FloatWindow.HANDLE_W) / 2f;
        p.x = Math.round(right ? handleCentre[0] - half - dp(GAP) - dp(SIZE) : handleCentre[0] + half + dp(GAP));
        p.y = Math.round(handleCentre[1] - dp(SIZE) / 2f);
        window.setAttributes(p);
        if (!dialog.isShowing()) {
            dialog.show();
            window.getDecorView().setAlpha(0);
            window.getDecorView().setScaleX(.7f);
            window.getDecorView().setScaleY(.7f);
            window.getDecorView().animate().alpha(1).scaleX(1).scaleY(1).setDuration(180)
                .setInterpolator(new android.view.animation.PathInterpolator(.2f, .8f, .2f, 1)).start();
        }
    }

    void hide() { if (dialog.isShowing()) dialog.dismiss(); }
}
