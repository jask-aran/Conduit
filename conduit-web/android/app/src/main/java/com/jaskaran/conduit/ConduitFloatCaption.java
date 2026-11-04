package com.jaskaran.conduit;

import android.app.Dialog;
import android.content.Context;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.TextView;

/**
 * Float's caption: the words heard so far, live, in a frosted card beside the pill (above it when the pill sits low on
 * the screen, below when high), on the same edge. Its own overlay window, so it has its own blur and never takes a touch.
 * It shows the latest few lines; older words leave from the top behind an ellipsis.
 */
final class ConduitFloatCaption {
    private static final int LINES = 3;
    private static final float WIDTH = 248, GAP = 8, PAD_X = 14, PAD_Y = 9;

    private final Context context;
    private final Dialog dialog;
    private final Window window;
    private final WindowManager.LayoutParams position;
    private final TextView text, header;
    private final android.widget.LinearLayout card;
    private final GradientDrawable frost = new GradientDrawable();
    private boolean shown;

    ConduitFloatCaption(Context context) {
        this.context = context;
        text = new TextView(context);
        text.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14);
        text.setLineSpacing(0, 1.15f);
        text.setTextColor(0xffe8e9eb);
        text.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        // Where the words go, as the app's labels: Paper Mono 10, uppercase, tracked, muted.
        header = new TextView(context);
        header.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 10);
        header.setAllCaps(true);
        header.setLetterSpacing(.07f);
        header.setTextColor(0xff8d8f94);
        header.setTypeface(androidx.core.content.res.ResourcesCompat.getFont(context, R.font.float_paper_mono));
        header.setSingleLine(true);
        header.setEllipsize(android.text.TextUtils.TruncateAt.END);
        header.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        card = new android.widget.LinearLayout(context);
        card.setOrientation(android.widget.LinearLayout.VERTICAL);
        card.setPadding(dp(PAD_X), dp(PAD_Y), dp(PAD_X), dp(PAD_Y));
        android.widget.LinearLayout.LayoutParams under = new android.widget.LinearLayout.LayoutParams(-2, -2);
        under.topMargin = dp(3);
        card.addView(header, new android.widget.LinearLayout.LayoutParams(-2, -2));
        card.addView(text, under);
        dialog = new Dialog(context, R.style.ConduitFloatTheme);
        dialog.setCancelable(false);
        window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        // Touchable (it ignores the taps): an untouchable overlay is capped at 80% opacity.
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setBackgroundDrawable(frost);
        window.setContentView(card);
        window.getDecorView().setPadding(0, 0, 0, 0);
        position = window.getAttributes();
        position.format = PixelFormat.TRANSLUCENT;
        if (Build.VERSION.SDK_INT >= 30) {
            position.setFitInsetsTypes(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            position.setFitInsetsIgnoringVisibility(true);
        }
        frost.setCornerRadius(dp(16));
        frost.setStroke(dp(1), 0x4dffffff);
    }

    private int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    /**
     * Shows words beside the pill. right: the edge it sits on; x: its distance from that edge; pillY and pillHeight
     * its place; screenHeight the room Float has; blurred whether cross-window blur is on.
     */
    void show(String words, String to, boolean right, int x, int pillY, int pillHeight, int screenHeight, boolean blurred) {
        words = words == null ? "" : words.trim();
        header.setText(to == null ? "" : to);
        header.setVisibility(to == null || to.isEmpty() ? View.GONE : View.VISIBLE);
        if (words.isEmpty()) { hide(); return; }
        int width = dp(WIDTH), inner = width - dp(2 * PAD_X);
        String tail = tail(words, inner);
        TextPaint paint = text.getPaint();
        StaticLayout layout = StaticLayout.Builder.obtain(tail, 0, tail.length(), paint, inner).setLineSpacing(0, 1.15f).build();
        // As wide as its words need, up to the card's width.
        float widest = 0;
        for (int i = 0; i < layout.getLineCount(); i++) widest = Math.max(widest, layout.getLineWidth(i));
        float headerWidth = header.getVisibility() == View.VISIBLE ? header.getPaint().measureText(header.getText().toString().toUpperCase()) * 1.07f : 0;
        position.width = Math.min(width, (int) Math.ceil(Math.max(widest, headerWidth)) + dp(2 * PAD_X) + 1);
        header.measure(View.MeasureSpec.makeMeasureSpec(inner, View.MeasureSpec.AT_MOST), View.MeasureSpec.UNSPECIFIED);
        int headerHeight = header.getVisibility() == View.VISIBLE ? header.getMeasuredHeight() + dp(3) : 0;
        position.height = layout.getHeight() + headerHeight + dp(2 * PAD_Y);
        // Above the pill: under it are the held captures and the radial's Screenshot and Camera.
        boolean above = pillY - dp(GAP) - position.height >= 0;
        position.gravity = Gravity.TOP | (right ? Gravity.RIGHT : Gravity.LEFT);
        position.x = x;
        position.y = above ? Math.max(0, pillY - dp(GAP) - position.height) : Math.min(screenHeight - position.height, pillY + pillHeight + dp(GAP));
        text.setText(tail);
        frost.setColor(androidx.core.graphics.ColorUtils.compositeColors(0x2bffffff, blurred ? 0xe63a3b3f : 0xfa3a3b3f));
        if (Build.VERSION.SDK_INT >= 31) window.setBackgroundBlurRadius(blurred ? dp(24) : 0);
        window.setAttributes(position);
        View decor = window.getDecorView();
        if (!shown) {
            shown = true;
            if (!dialog.isShowing()) dialog.show();
            decor.setVisibility(View.VISIBLE);
            decor.setAlpha(0);
            decor.setTranslationY(dp(above ? 4 : -4));
            decor.animate().alpha(1).translationY(0).setDuration(160).start();
        }
    }

    /** The last LINES lines of the words, older ones dropped from the front behind an ellipsis. */
    private String tail(String words, int inner) {
        TextPaint paint = text.getPaint();
        String shown = words;
        while (true) {
            StaticLayout layout = StaticLayout.Builder.obtain(shown, 0, shown.length(), paint, inner).build();
            if (layout.getLineCount() <= LINES) return shown;
            // Drop the first line's worth of words and try again.
            int cut = layout.getLineEnd(0);
            String rest = shown.substring(Math.min(shown.length(), cut)).trim();
            if (rest.startsWith("…")) rest = rest.substring(1).trim();
            if (rest.isEmpty()) return words.substring(Math.max(0, words.length() - 40));
            shown = "… " + rest;
        }
    }

    void hide() {
        if (!shown) return;
        shown = false;
        View decor = window.getDecorView();
        decor.animate().alpha(0).setDuration(140).withEndAction(() -> { if (!shown) decor.setVisibility(View.GONE); }).start();
    }

    void destroy() {
        shown = false;
        window.getDecorView().animate().cancel();
        if (dialog.isShowing()) dialog.dismiss();
    }
}
