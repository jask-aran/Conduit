package com.jaskaran.conduit;

import android.app.Dialog;
import android.content.Context;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.InsetDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.animation.PathInterpolator;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** One-use native overlay. Construct and show on the main thread; coordinates are pixels. */
public abstract class FloatPanel {
    protected static final int PRIMARY = 0xffe8e9eb, SECONDARY = 0x99e8e9eb;
    private static final ExecutorService HUB = Executors.newSingleThreadExecutor();
    protected final Handler main = new Handler(Looper.getMainLooper());
    protected final Context context;
    protected final ConduitHubClient hub;
    protected final LinearLayout body, footer, top;
    protected final ScrollView scroll;
    private final LinearLayout root, header;
    private final Dialog dialog;
    private final Window window;
    private final WindowManager manager;
    private final GradientDrawable frost = new GradientDrawable();
    private Consumer<Boolean> blurListener;
    private boolean shown, closed, stoppingInput, imeVisible;
    private int screenTop, screenHeight, centerY, request, keyboardInset;

    protected FloatPanel(Context context, ConduitHubClient hub) {
        this.context = context;
        this.hub = hub;
        manager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        root = new LinearLayout(context) {
            @Override protected void onMeasure(int w, int h) {
                int cap = Math.min((int) (screenHeight * .6f), Math.max(0, screenHeight - keyboardInset - dp(32)));
                if (View.MeasureSpec.getMode(h) != View.MeasureSpec.UNSPECIFIED)
                    cap = Math.min(cap, View.MeasureSpec.getSize(h));
                int innerWidth = View.MeasureSpec.getSize(w) - getPaddingLeft() - getPaddingRight();
                int childWidth = View.MeasureSpec.makeMeasureSpec(Math.max(0, innerWidth), View.MeasureSpec.EXACTLY);
                int used = getPaddingTop() + getPaddingBottom();
                // Reserve fixed controls before measuring the reply; a long reply must not consume its footer.
                for (int i = 0; i < getChildCount(); i++) {
                    View child = getChildAt(i);
                    if (child == scroll || child.getVisibility() == View.GONE) continue;
                    child.measure(childWidth, View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
                    used += child.getMeasuredHeight();
                }
                scroll.measure(childWidth, View.MeasureSpec.makeMeasureSpec(Math.max(0, cap - used), View.MeasureSpec.AT_MOST));
                setMeasuredDimension(View.MeasureSpec.getSize(w), Math.min(cap, used + scroll.getMeasuredHeight()));
            }
            @Override protected void onLayout(boolean changed, int l, int t, int r, int b) {
                int y = getPaddingTop();
                for (int i = 0; i < getChildCount(); i++) {
                    View child = getChildAt(i);
                    if (child.getVisibility() == View.GONE) continue;
                    child.layout(getPaddingLeft(), y, getWidth() - getPaddingRight(), y + child.getMeasuredHeight());
                    y += child.getMeasuredHeight();
                }
            }
        };
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(0, dp(8), 0, dp(8));
        root.setFocusableInTouchMode(true);
        root.setClipToOutline(true);
        root.setOutlineProvider(new android.view.ViewOutlineProvider() {
            @Override public void getOutline(View view, android.graphics.Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(20));
            }
        });
        header = column();
        top = column();
        body = column();
        footer = column();
        scroll = new ScrollView(context);
        scroll.setFillViewport(false);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.addView(body);
        root.addView(header);
        root.addView(top);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, -2));
        root.addView(footer);
        dialog = new Dialog(context, R.style.ConduitFloatTheme) {
            @Override public boolean dispatchTouchEvent(MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_OUTSIDE) { close(); return true; }
                return super.dispatchTouchEvent(event);
            }
        };
        dialog.setCancelable(false);
        window = dialog.getWindow();
        window.setType(Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        window.setBackgroundDrawable(frost);
        window.setContentView(root);
        View decor = window.getDecorView();
        decor.setPadding(0, 0, 0, 0);
        dialog.setOnDismissListener(ignored -> {
            closed = true;
            stopInput();
            releaseBlur();
            onClosed();
        });
        frost.setCornerRadius(dp(20));
        frost.setStroke(dp(1), 0x4dffffff);
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> place());
        root.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            if (!shown || closed) return;
            Rect visible = new Rect();
            root.getWindowVisibleDisplayFrame(visible);
            int nextInset = Math.max(0, screenTop + screenHeight - visible.bottom);
            if (nextInset != keyboardInset) {
                if (Build.VERSION.SDK_INT < 30 && keyboardInset > dp(100) && nextInset <= dp(100)
                        && root.findFocus() instanceof EditText) stopInput();
                keyboardInset = nextInset;
                root.requestLayout();
                place();
            }
        });
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                boolean visible = insets.isVisible(WindowInsets.Type.ime());
                if (imeVisible && !visible && root.findFocus() instanceof EditText) stopInput();
                imeVisible = visible;
                return insets;
            });
        }
    }

    public final void show(boolean right, int centerY) {
        if (closed || shown) return;
        this.centerY = centerY;
        Rect bounds;
        if (Build.VERSION.SDK_INT >= 30) {
            android.view.WindowMetrics metrics = manager.getCurrentWindowMetrics();
            bounds = new Rect(metrics.getBounds());
            android.graphics.Insets insets = metrics.getWindowInsets().getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            bounds.inset(insets.left, insets.top, insets.right, insets.bottom);
            this.centerY -= bounds.top;
        } else {
            android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
            manager.getDefaultDisplay().getMetrics(metrics);
            bounds = new Rect(0, 0, metrics.widthPixels, metrics.heightPixels);
        }
        screenTop = bounds.top;
        screenHeight = bounds.height();
        int width = Math.min(Math.max(1, bounds.width() - dp(32)), dp(360));
        WindowManager.LayoutParams p = window.getAttributes();
        p.format = PixelFormat.TRANSLUCENT;
        p.width = width;
        p.height = -2;
        p.gravity = Gravity.TOP | (right ? Gravity.RIGHT : Gravity.LEFT);
        p.x = dp(16);
        p.y = Math.max(dp(16), this.centerY);
        p.windowAnimations = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            p.setFitInsetsTypes(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            p.setFitInsetsIgnoringVisibility(true);
        }
        window.setAttributes(p);
        updateBlur(Build.VERSION.SDK_INT >= 31 && manager.isCrossWindowBlurEnabled());
        shown = true;
        dialog.show();
        if (Build.VERSION.SDK_INT >= 31) {
            blurListener = enabled -> { if (!closed) updateBlur(enabled); };
            manager.addCrossWindowBlurEnabledListener(context.getMainExecutor(), blurListener);
        }
        root.requestFocus();
        View decor = window.getDecorView();
        decor.setAlpha(0);
        decor.setTranslationX(dp(right ? 6 : -6));
        decor.animate().alpha(1).translationX(0).setDuration(180)
            .setInterpolator(new PathInterpolator(.2f, 0, 0, 1)).start();
        onOpen();
    }

    private void place() {
        if (!shown || closed) return;
        WindowManager.LayoutParams p = window.getAttributes();
        int y = Math.max(dp(16), Math.min(centerY - root.getHeight() / 2, screenHeight - keyboardInset - dp(16) - root.getHeight()));
        if (p.y != y) { p.y = y; window.setAttributes(p); }
    }

    private void updateBlur(boolean blurred) {
        frost.setColor(androidx.core.graphics.ColorUtils.compositeColors(0x2bffffff, blurred ? 0xe63a3b3f : 0xfa3a3b3f));
        if (Build.VERSION.SDK_INT >= 31) window.setBackgroundBlurRadius(blurred ? dp(24) : 0);
    }

    private void releaseBlur() {
        if (Build.VERSION.SDK_INT >= 31 && blurListener != null) {
            manager.removeCrossWindowBlurEnabledListener(blurListener);
            blurListener = null;
        }
    }

    public final boolean isOpen() { return shown && !closed; }

    public final void close() {
        if (closed) return;
        closed = true;
        request++;
        stopInput();
        releaseBlur();
        onClosing();
        if (!shown) { onClosed(); return; }
        window.getDecorView().animate().cancel();
        window.getDecorView().animate().alpha(0).setDuration(140).withEndAction(dialog::dismiss).start();
    }

    protected abstract void onOpen();
    protected abstract void onClosed();
    protected void onClosing() {}

    protected final void heading(String title, Runnable back) {
        header.removeAllViews();
        LinearLayout line = new LinearLayout(context);
        line.setGravity(Gravity.CENTER_VERTICAL);
        if (back != null) {
            TextView button = button("‹", back);
            button.setTextSize(26);
            button.setContentDescription("Back");
            line.addView(button, new LinearLayout.LayoutParams(dp(48), dp(48)));
        }
        TextView label = text(title, 15, PRIMARY);
        label.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        label.setPadding(back == null ? dp(16) : 0, 0, dp(16), 0);
        label.setGravity(Gravity.CENTER_VERTICAL);
        line.addView(label, new LinearLayout.LayoutParams(0, dp(48), 1));
        header.addView(line);
    }

    protected final LinearLayout column() {
        LinearLayout column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        return column;
    }

    protected final int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    protected final TextView text(CharSequence value, int sp, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setHighlightColor(0x33ffffff);
        return view;
    }

    protected final void rowStyle(View view) {
        view.setMinimumHeight(dp(48));
        view.setPadding(dp(16), dp(8), dp(16), dp(8));
        GradientDrawable wash = new GradientDrawable();
        wash.setColor(0x12ffffff);
        wash.setCornerRadius(dp(12));
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {android.R.attr.state_pressed}, new InsetDrawable(wash, dp(4)));
        states.addState(new int[] {android.R.attr.state_focused}, new InsetDrawable(wash, dp(4)));
        view.setBackground(states);
    }

    protected final TextView button(String label, Runnable action) {
        TextView button = text(label, 13, SECONDARY);
        rowStyle(button);
        button.setGravity(Gravity.CENTER);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    protected final EditText input(String hint) {
        EditText field = new EditText(context);
        field.setTextSize(15);
        field.setTextColor(PRIMARY);
        field.setHintTextColor(SECONDARY);
        field.setHighlightColor(0x33ffffff);
        field.setHint(hint);
        field.setSingleLine(true);
        android.graphics.drawable.ShapeDrawable underline = new android.graphics.drawable.ShapeDrawable(
                new android.graphics.drawable.shapes.RectShape()) {
            @Override protected void onDraw(android.graphics.drawable.shapes.Shape shape,
                    android.graphics.Canvas canvas, android.graphics.Paint paint) {
                canvas.drawRect(0, getBounds().height() - dp(1), getBounds().width(), getBounds().height(), paint);
            }
        };
        underline.getPaint().setColor(0x33ffffff);
        field.setBackground(underline);
        if (Build.VERSION.SDK_INT >= 29) {
            GradientDrawable cursor = new GradientDrawable();
            cursor.setColor(PRIMARY);
            cursor.setSize(dp(2), dp(20));
            field.setTextCursorDrawable(cursor);
            GradientDrawable handle = new GradientDrawable();
            handle.setShape(GradientDrawable.OVAL);
            handle.setColor(PRIMARY);
            handle.setSize(dp(16), dp(16));
            field.setTextSelectHandle(handle);
            field.setTextSelectHandleLeft(handle.getConstantState().newDrawable());
            field.setTextSelectHandleRight(handle.getConstantState().newDrawable());
        }
        field.setMinimumHeight(dp(48));
        field.setPadding(dp(16), 0, dp(16), 0);
        field.setOnFocusChangeListener((v, focused) -> {
            if (focused && !closed) {
                window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
                field.post(() -> {
                    if (isOpen() && field.hasFocus()) ((InputMethodManager) context.getSystemService(Context.INPUT_METHOD_SERVICE))
                        .showSoftInput(field, InputMethodManager.SHOW_IMPLICIT);
                });
            } else stopInput();
        });
        return field;
    }

    protected final void stopInput() {
        if (stoppingInput) return;
        stoppingInput = true;
        try {
            ((InputMethodManager) context.getSystemService(Context.INPUT_METHOD_SERVICE))
                .hideSoftInputFromWindow(window.getDecorView().getWindowToken(), 0);
            root.requestFocus();
            window.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        } finally {
            stoppingInput = false;
        }
    }

    protected final void line(String value, int color) {
        TextView view = text(value, color == PRIMARY ? 15 : 13, color);
        view.setPadding(dp(16), dp(8), dp(16), dp(8));
        body.addView(view);
    }

    protected final void error(String message, Runnable retry) {
        body.removeAllViews();
        line(message, PRIMARY);
        body.addView(button("Try again", retry));
    }

    @FunctionalInterface protected interface HubCall<T> { T run() throws ConduitHubClient.Failure; }

    protected final <T> void load(HubCall<T> call, Consumer<T> result, Runnable retry) {
        int ticket = ++request;
        body.removeAllViews();
        line("Loading…", SECONDARY);
        HUB.execute(() -> {
            try {
                T value = call.run();
                main.post(() -> { if (isOpen() && request == ticket) result.accept(value); });
            } catch (ConduitHubClient.Failure failure) {
                main.post(() -> { if (isOpen() && request == ticket) error(failure.message, retry); });
            }
        });
    }
}
