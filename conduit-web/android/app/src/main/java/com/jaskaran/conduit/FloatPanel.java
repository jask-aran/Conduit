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

/**
 * One-use native overlay in v2's popover language (popover.css .ui-menu, read off the phone's WebView): 240dp wide,
 * radius 14, a 6dp frost inset, FloatFrost over Samsung's live blur (or the screen behind it); 40dp rows of Geist 13.5 at weight 500 in the
 * foreground at 68%, washed white 7% at radius 8 while pressed; section labels in Paper Mono 10 uppercase. It rises
 * in 8dp over 250ms on --ease-arrive and drops back over 150ms on --ease-leave. Construct and show on the main thread.
 */
public abstract class FloatPanel {
    /** --foreground; a row's resting text (the foreground at 68%, over frost); --muted-foreground; --tint. */
    protected static final int PRIMARY = 0xffe8e9eb, ROW = 0xade8e9eb, SECONDARY = 0xff8d8f94, TINT = 0x12ffffff;
    protected final Typeface geist, paperMono;
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
    private final FloatFrost frost;
    private Consumer<Boolean> blurListener;
    private boolean shown, closed, stoppingInput, imeVisible;
    private int screenTop, screenHeight, centerY, request, keyboardInset;

    protected FloatPanel(Context context, ConduitHubClient hub) {
        this.context = context;
        this.hub = hub;
        geist = androidx.core.content.res.ResourcesCompat.getFont(context, R.font.composer_geist);
        paperMono = androidx.core.content.res.ResourcesCompat.getFont(context, R.font.float_paper_mono);
        frost = new FloatFrost(dp(14), Math.max(1, dp(.8f)));
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
        root.setPadding(dp(6), dp(6), dp(6), dp(6));
        root.setFocusableInTouchMode(true);
        root.setClipToOutline(true);
        root.setOutlineProvider(new android.view.ViewOutlineProvider() {
            @Override public void getOutline(View view, android.graphics.Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(14));
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
        // The menu's raised lift (--frost-lift-raised, read off the WebView's .ui-menu): 0 24px 70px black at 38%.
        decor.setElevation(dp(24));
        if (Build.VERSION.SDK_INT >= 28) { decor.setOutlineAmbientShadowColor(0); decor.setOutlineSpotShadowColor(0x61000000); }
        // Samsung's live blur behind the card, clear, the frost drawn over it: no screenshot, no Screen context needed.
        if (FloatLiveBlur.frost(window, root, frost)) {
            frost.setLive(true);
            FloatLiveBlur.apply(decor, FloatLiveBlur.radius(context), 0, dp(14));
        }
        dialog.setOnDismissListener(ignored -> {
            closed = true;
            frost.setBackdrop(null);
            if (backdrop != null) { backdrop.recycle(); backdrop = null; }
            stopInput();
            releaseBlur();
            onClosed();
        });
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

    /**
     * Shows the panel. With the screen reader on, it first takes the screen behind it as its frost backdrop (Float's
     * windows get no system blur on phones without cross-window blur); the panel waits for it at most 400ms.
     */
    public final void show(boolean right, int centerY) {
        if (closed || shown || waiting) return;
        ConduitScreenReader reader = ConduitScreenReader.instance;
        boolean wantsBlur = !(Build.VERSION.SDK_INT >= 31 && manager.isCrossWindowBlurEnabled()) && !FloatLiveBlur.available();
        if (wantsBlur && reader != null && Build.VERSION.SDK_INT >= 30 && ConduitContext.screenReaderOn(context)) {
            waiting = true;
            final boolean[] done = { false };
            Runnable reveal = () -> { if (!done[0]) { done[0] = true; waiting = false; reveal(right, centerY); } };
            main.postDelayed(reveal, 400);
            ConduitContext.afterFrames(() -> reader.backdrop(bitmap -> main.post(() -> {
                if (done[0] || closed) { if (bitmap != null) bitmap.recycle(); return; }
                backdrop = bitmap;
                frost.setBackdrop(bitmap);
                reveal.run();
            })));
            return;
        }
        reveal(right, centerY);
    }

    private boolean waiting;
    /** When the opening rise ends (uptime ms); until it has started, a while from now. */
    private volatile long settledAt = Long.MAX_VALUE / 2;
    private android.graphics.Bitmap backdrop;
    private boolean rightEdge;
    private int screenLeft, screenWidth;

    private void reveal(boolean right, int centerY) {
        if (closed || shown) return;
        rightEdge = right;
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
        screenLeft = bounds.left;
        screenWidth = bounds.width();
        int width = Math.min(Math.max(1, bounds.width() - dp(32)), dp(width()));
        WindowManager.LayoutParams p = window.getAttributes();
        p.format = PixelFormat.TRANSLUCENT;
        p.width = width;
        p.height = -2;
        p.gravity = Gravity.TOP | (right ? Gravity.RIGHT : Gravity.LEFT);
        // Beside Float's handle (6dp off the edge, 32dp wide) with 8dp between.
        p.x = dp(46);
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
        decor.setTranslationY(dp(8));
        onOpen();
        // The rise starts once the window's first frame is up: its layout, fonts and backdrop upload would otherwise
        // eat the curve's opening frames, where it moves fastest.
        decor.getViewTreeObserver().addOnDrawListener(new android.view.ViewTreeObserver.OnDrawListener() {
            boolean started;
            @Override public void onDraw() {
                if (started) return;
                started = true;
                decor.post(() -> {
                    decor.getViewTreeObserver().removeOnDrawListener(this);
                    if (closed) return;
                    android.view.Choreographer.getInstance().postFrameCallback(t -> {
                        if (closed) return;
                        settledAt = android.os.SystemClock.uptimeMillis() + 260;
                        decor.animate().alpha(1).translationY(0).setDuration(250)
                            .setInterpolator(new PathInterpolator(.2f, .8f, .2f, 1)).start();
                    });
                });
            }
        });
    }

    private void place() {
        if (!shown || closed) return;
        WindowManager.LayoutParams p = window.getAttributes();
        int y = Math.max(dp(16), Math.min(centerY - root.getHeight() / 2, screenHeight - keyboardInset - dp(16) - root.getHeight()));
        if (p.y != y) { p.y = y; window.setAttributes(p); }
        // The window's top-left on screen, for the frost's backdrop.
        frost.setOrigin(rightEdge ? screenLeft + screenWidth - p.x - p.width : screenLeft + p.x, screenTop + y);
    }

    /** The panel's width in dp: v2's phone menu cap (--measure-sm). */
    protected int width() { return 240; }

    private void updateBlur(boolean blurred) {
        frost.setBlurred(blurred);
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
        window.getDecorView().animate().alpha(0).translationY(dp(8)).setDuration(150)
            .setInterpolator(new PathInterpolator(.4f, 0, 1, 1)).withEndAction(dialog::dismiss).start();
    }

    protected abstract void onOpen();
    protected abstract void onClosed();
    protected void onClosing() {}

    /** The popover's title (.ui-title): its label face, muted, 6/8 padding; a back chevron before it when it has one. */
    protected final void heading(String title, Runnable back) {
        header.removeAllViews();
        LinearLayout line = new LinearLayout(context);
        line.setGravity(Gravity.CENTER_VERTICAL);
        if (back != null) {
            android.widget.ImageView chevron = new android.widget.ImageView(context);
            chevron.setImageResource(R.drawable.float_back);
            chevron.setImageTintList(android.content.res.ColorStateList.valueOf(SECONDARY));
            chevron.setScaleType(android.widget.ImageView.ScaleType.CENTER);
            chevron.setContentDescription("Back");
            chevron.setOnClickListener(v -> back.run());
            wash(chevron);
            line.addView(chevron, new LinearLayout.LayoutParams(dp(30), dp(30)));
        }
        TextView name = label(title);
        name.setSingleLine(true);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setPadding(dp(back == null ? 8 : 4), dp(6), dp(8), dp(6));
        line.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        header.addView(line);
    }

    protected final LinearLayout column() {
        LinearLayout column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        return column;
    }

    protected final int dp(float value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }

    protected final Typeface face(int weight) {
        return Build.VERSION.SDK_INT >= 28 ? Typeface.create(geist, weight, false) : geist;
    }

    protected final TextView text(CharSequence value, float sp, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setTypeface(face(400));
        view.setIncludeFontPadding(false);
        view.setHighlightColor(0x33ffffff);
        return view;
    }

    /** A row's title: --text-row, weight 500 over frost, the foreground at 68%. */
    protected final TextView rowText(CharSequence value) {
        TextView view = text(value, 13.5f, ROW);
        view.setTypeface(face(500));
        view.setSingleLine(true);
        view.setEllipsize(TextUtils.TruncateAt.END);
        return view;
    }

    /** A row's second line or meta (.ui-detail): --text-caption, muted. */
    protected final TextView detail(CharSequence value) {
        TextView view = text(value, 12, SECONDARY);
        view.setSingleLine(true);
        view.setEllipsize(TextUtils.TruncateAt.END);
        return view;
    }

    /** A section's label: Paper Mono 10, uppercase, tracked .07em, muted. */
    protected final TextView label(String value) {
        TextView view = text(value.toUpperCase(java.util.Locale.ROOT), 10, SECONDARY);
        view.setTypeface(paperMono);
        view.setLetterSpacing(.07f);
        return view;
    }

    /** The pressed wash: --tint at --radius-control. */
    protected final void wash(View view) {
        GradientDrawable wash = new GradientDrawable();
        wash.setColor(TINT);
        wash.setCornerRadius(dp(8));
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[] {android.R.attr.state_pressed}, wash);
        states.addState(new int[] {android.R.attr.state_focused}, wash);
        view.setBackground(states);
    }

    /** A menu row (.ui-row[data-density=menu]): 40dp tall on a phone, padding 6/8, the pressed wash. */
    protected final void rowStyle(View view) {
        view.setMinimumHeight(dp(40));
        view.setPadding(dp(8), dp(6), dp(8), dp(6));
        wash(view);
    }

    /**
     * A menu row with its icon slot (.ui-icon, 16dp, muted at rest; a workspace's glyph keeps its colour), its label,
     * and its meta at the end (.ui-meta: muted Paper Mono caption).
     */
    protected final LinearLayout iconRow(int icon, Integer colour, CharSequence name, String meta) {
        android.widget.ImageView glyph = new android.widget.ImageView(context);
        glyph.setImageResource(icon);
        glyph.setImageTintList(android.content.res.ColorStateList.valueOf(colour == null ? SECONDARY : colour));
        glyph.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        return leadRow(glyph, name, meta);
    }

    /** A workspace's monogram in its icon slot: its letters in its colour, bold, filling the 16dp square. */
    protected final TextView monogram(String letters, int colour) {
        TextView mark = text(letters, letters.length() > 1 ? 9 : 11, colour);
        mark.setTypeface(face(700));
        mark.setGravity(Gravity.CENTER);
        return mark;
    }

    protected final LinearLayout leadRow(View lead, CharSequence name, String meta) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        rowStyle(row);
        LinearLayout.LayoutParams slot = new LinearLayout.LayoutParams(dp(16), dp(16));
        slot.setMarginEnd(dp(8));
        row.addView(lead, slot);
        row.addView(rowText(name), new LinearLayout.LayoutParams(0, -2, 1));
        if (meta != null) {
            TextView end = detail(meta);
            end.setTypeface(paperMono);
            end.setPadding(dp(8), 0, 0, 0);
            row.addView(end);
        }
        return row;
    }

    /** An action as a menu row: its name in the row's voice. */
    protected final TextView button(String label, Runnable action) {
        TextView button = rowText(label);
        rowStyle(button);
        button.setGravity(Gravity.CENTER_VERTICAL);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    /** A section rule (.ui-section + .ui-section): a hairline of --tint across the whole panel, 6dp each side. */
    protected final View rule() {
        View rule = new View(context);
        rule.setBackgroundColor(TINT);
        LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(-1, Math.max(1, dp(.5f)));
        size.setMargins(-dp(6), dp(6), -dp(6), dp(6));
        rule.setLayoutParams(size);
        return rule;
    }

    protected final EditText input(String hint) {
        // The search section (.ui-search): no box, --text-row, the hint muted; its rule follows it.
        EditText field = new EditText(context);
        field.setTypeface(face(400));
        field.setTextSize(13.5f);
        field.setTextColor(PRIMARY);
        field.setHintTextColor(SECONDARY);
        field.setHighlightColor(0x33ffffff);
        field.setHint(hint);
        field.setSingleLine(true);
        field.setBackground(null);
        if (Build.VERSION.SDK_INT >= 29) {
            GradientDrawable cursor = new GradientDrawable();
            cursor.setColor(PRIMARY);
            cursor.setSize(Math.max(1, dp(1.5f)), dp(16));
            field.setTextCursorDrawable(cursor);
            GradientDrawable handle = new GradientDrawable();
            handle.setShape(GradientDrawable.OVAL);
            handle.setColor(PRIMARY);
            handle.setSize(dp(16), dp(16));
            field.setTextSelectHandle(handle);
            field.setTextSelectHandleLeft(handle.getConstantState().newDrawable());
            field.setTextSelectHandleRight(handle.getConstantState().newDrawable());
        }
        field.setMinimumHeight(dp(40));
        field.setPadding(dp(8), 0, dp(8), 0);
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

    /** A note (.ui-note[data-note=menu]): --text-caption at row padding, muted, or the foreground for an error. */
    protected final void line(String value, int color) {
        TextView view = text(value, 12, color);
        view.setLineSpacing(0, 1.35f);
        view.setPadding(dp(8), dp(6), dp(8), dp(6));
        body.addView(view);
    }

    protected final void error(String message, Runnable retry) {
        body.removeAllViews();
        line(message, PRIMARY);
        body.addView(button("Try again", retry));
    }

    @FunctionalInterface protected interface HubCall<T> { T run() throws ConduitHubClient.Failure; }

    /** The last answer to each panel's list, so a panel opens at its full size and does not grow mid-rise. */
    private static final java.util.Map<String, Object> LAST = new java.util.concurrent.ConcurrentHashMap<>();

    /** The last answer for key, or null (another panel's list: Recent reads the places for their glyphs). */
    static Object last(String key) { return LAST.get(key); }
    /** Another hub: its lists are not this one's, so none of them may show (or be chosen) while it loads. */
    static void forget() { synchronized (LAST) { generation++; LAST.clear(); } }
    /** Bumped by forget: an answer fetched for an earlier hub is not kept. */
    private static int generation;
    private static int generation() { synchronized (LAST) { return generation; } }
    private static void remember(int asked, String key, Object value) { synchronized (LAST) { if (asked == generation) LAST.put(key, value); } }

    /** Fetches a list ahead of its panel (as the radial opens), so even a first open has its rows. */
    static <T> void warm(String key, HubCall<T> call) {
        int asked = generation();
        HUB.execute(() -> { try { remember(asked, key, call.run()); } catch (ConduitHubClient.Failure | RuntimeException ignored) {} });
    }

    /** The last list at once when there is one (else Loading…), then the fresh one in its place. */
    @SuppressWarnings("unchecked")
    protected final <T> void load(String key, HubCall<T> call, Consumer<T> result, Runnable retry) {
        int ticket = ++request;
        body.removeAllViews();
        Object last = LAST.get(key);
        if (last != null) result.accept((T) last); else line("Loading…", SECONDARY);
        int asked = generation();
        HUB.execute(() -> {
            try {
                T value = call.run();
                remember(asked, key, value);
                // Over a shown list, the fresh one waits for the rise to end: rebuilding rows mid-curve drops frames.
                long wait = last == null ? 0 : Math.min(700, Math.max(0, settledAt - android.os.SystemClock.uptimeMillis()));
                main.postDelayed(() -> { if (isOpen() && request == ticket) result.accept(value); }, wait);
            } catch (ConduitHubClient.Failure failure) {
                main.post(() -> { if (isOpen() && request == ticket && last == null) error(failure.message, retry); });
            }
        });
    }
}
