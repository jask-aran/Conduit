package com.jaskaran.conduit;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.SystemClock;
import android.text.TextPaint;
import android.text.TextUtils;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;

import static com.jaskaran.conduit.FloatWindow.PILL;
import static com.jaskaran.conduit.FloatWindow.HANDLE_W;
import com.jaskaran.conduit.FloatMachine.State;

/** One bounded overlay window, with separate accessible Cancel and Stop buttons. */
final class FloatView extends FrameLayout {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint text = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Drawable mark = getContext().getDrawable(R.drawable.ic_stat_conduit).mutate();
    private final ImageButton cancelButton, stopButton;
    private float downX, downY;
    private int initialX, initialY;
    private boolean dragging, moved;
    /* The Aura, as the app's (components/ui/pill.tsx): a mesh of five coloured blobs behind the frost, each circling near
       its edge, every point their blend by distance with the hue held. Drawn small and scaled up; the level turns them
       faster, brightens them and moves their balance. It shows while recording and drains after. */
    private final float[][] blobs = { // from (deg), l, c, h, orbit (s a turn), swell
        { 180, .58f, .2f, 290, 7, .5f }, { 300, .64f, .21f, 22, -9, -.35f }, { 60, .64f, .23f, 345, 11, .6f },
        { 0, .74f, .17f, 62, -13, .45f }, { 125, .6f, .2f, 315, 8, -.3f } };
    private final float[] turns = { 0, 1.3f, 2.6f, 3.9f, 5.2f };
    /* Scale: the blobs' size against the surface (the app's is 1); tempo: how fast they turn. At the app's size they
       blend into one still gradient across a pill this small, so Float's are smaller and quicker. */
    private static final float AURA_SCALE = .45f, AURA_TEMPO = 2.2f;
    private Bitmap aura;
    private int[] auraPixels;
    private float auraShown, auraLevel;
    private long auraLast;
    private final Paint auraPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Path clip = new Path();
    private final float[] bx = new float[blobs.length], by = new float[blobs.length], br = new float[blobs.length],
        bl = new float[blobs.length], bc = new float[blobs.length], ba = new float[blobs.length], bb = new float[blobs.length];
    private final RectF auraBounds = new RectF();
    private android.graphics.LinearGradient highlight, sheenGradient;
    private int sheenBucket = -1;
    private final Path tick = new Path(), tickPart = new Path();
    private final android.graphics.PathMeasure tickMeasure = new android.graphics.PathMeasure();
    private String errorLine = "", errorLineText;
    private int errorLineWidth = -1;
    private float errorLineDensity;

    @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        tick.rewind();
        tick.moveTo(-dp(6), dp(.5f));
        tick.lineTo(-dp(1.75f), dp(4.5f));
        tick.lineTo(dp(6.5f), -dp(4.5f));
        tickMeasure.setPath(tick, false);
        auraBounds.set(0, 0, w, h);
        highlight = new android.graphics.LinearGradient(0, dp(1), 0, h / 2f,
            0x59ffffff, 0x00ffffff, android.graphics.Shader.TileMode.CLAMP);
        sheenBucket = -1;
        int gw = 64, gh = Math.max(4, Math.round(64f * h / Math.max(1, w)));
        if (aura != null && aura.getHeight() != gh) {
            aura = Bitmap.createBitmap(gw, gh, Bitmap.Config.ARGB_8888);
            auraPixels = new int[gw * gh];
        }
    }

    interface Listener {
        void onTap();
        void onCancel();
        void onSend();
        void onRetry();
        void onDragEnded();
        /** Held still at rest for HOLD_MS, with Hold to talk on: a hold begins (the recorder pill opens). */
        void onHoldStart();
        /** The held finger moved, in screen pixels. */
        void onHoldMove(float rawX, float rawY);
        /** The hold let go; cancelled when dragged well away first, or when the system took the gesture away. */
        void onHoldEnd(boolean cancelled);
    }
    /** How long a still press at rest waits before it is a hold rather than a tap. */
    private static final long HOLD_MS = 250;
    private boolean holding;
    private final Runnable holdStart = () -> {
        if (this.state != State.HANDLE || this.moved || this.holding) return;
        holding = true;
        performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
        listenerHoldStart();
    };
    private final FloatWindow window;
    private final Listener listener;
    private void listenerHoldStart() { listener.onHoldStart(); }
    private State state = State.HANDLE;
    private String errorText = "Couldn't send — open Conduit";
    private float level;
    /** How many captures (screenshots, photos) Float is holding for the next message; shown as a badge at rest. */
    private int gathered;
    private final Paint badgePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final android.text.TextPaint badgeText = new android.text.TextPaint(Paint.ANTI_ALIAS_FLAG);
    void setGathered(int count) { if (gathered != count) { gathered = count; invalidate(); } }

    /** Where the recording goes (its bubble sits under the pill, the radial's): for Send's spoken name. */
    void setTarget(int icon, String name) { stopButton.setContentDescription("Send to " + name); }
    private long sentAt;

    FloatView(Context context, FloatWindow window, Listener listener, State state) {
        super(context);
        this.window = window;
        this.listener = listener;
        this.state = state;
        setWillNotDraw(false);
        setClickable(true);
        // Conduit's dark tokens: foreground oklch(.93) ~ #e8e9eb, background oklch(.186) ~ #141518, tint white 7%.
        cancelButton = new ImageButton(getContext());
        cancelButton.setImageResource(R.drawable.float_cancel);
        cancelButton.setImageTintList(ColorStateList.valueOf(0xbfe8e9eb));
        cancelButton.setScaleType(ImageView.ScaleType.CENTER);
        cancelButton.setContentDescription("Cancel");
        cancelButton.setBackground(roundButton(0x12ffffff));
        cancelButton.setOnClickListener(view -> listener.onCancel());
        addView(cancelButton);
        // Send, as the phone composer's Stop and send: the primary button, light with a dark arrow.
        stopButton = new ImageButton(getContext());
        stopButton.setImageResource(R.drawable.float_send);
        stopButton.setImageTintList(ColorStateList.valueOf(0xff141518));
        stopButton.setScaleType(ImageView.ScaleType.CENTER);
        stopButton.setContentDescription("Send to jbot");
        stopButton.setBackground(roundButton(0xffe8e9eb));
        stopButton.setOnClickListener(view -> { if (state == State.RECORDING) listener.onSend(); });
        addView(stopButton);
    }

    private int dp(float value) { return window.dp(value); }

    private GradientDrawable roundButton(int fill) {
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(fill);
        return background;
    }

    void show(State next, String errorText, long sentAt) {
        state = next;
        this.errorText = errorText;
        this.sentAt = sentAt;
        level = 0;
        buttons();
        setClickable(next == State.HANDLE || next == State.ERROR);
        setContentDescription(next == State.HANDLE ? "Float. Talk to jbot. Drag to move."
            : next == State.RECORDING ? "Recording" : next == State.ERROR ? errorText + ". Tap to retry or open Conduit."
            : next == State.SENT ? "Sent" : "Sending to jbot");
    }

    void updateLevel(float loud) {
        level += (loud - level) * (loud > level ? .6f : .18f);
        invalidate();
    }

    private void buttons() {
        // Sending and sent are the small bubble's own drawing; the buttons are the pill's.
        cancelButton.setVisibility(state == State.RECORDING || state == State.ERROR ? VISIBLE : GONE);
        stopButton.setVisibility(state == State.RECORDING ? VISIBLE : GONE);
        stopButton.setEnabled(state == State.RECORDING);
    }

    @Override protected void onMeasure(int width, int height) {
        int button = MeasureSpec.makeMeasureSpec(dp(36), MeasureSpec.EXACTLY);
        cancelButton.measure(button, button);
        stopButton.measure(button, button);
        setMeasuredDimension(window.frameWidth, window.frameHeight);
    }

    /** How far the content has faded in: it waits until the pill is mostly open, and leaves first on close. */
    private float contentAlpha() { return Math.max(0, Math.min(1, (window.openness - .45f) / .55f)); }

    @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        // The content keeps its final place while the window grows out from the bubble's edge.
        int width = state == State.HANDLE ? dp(PILL) : window.controlWidth();
        int offset = window.prefs().getBoolean("right", true) ? getWidth() - width : 0;
        int y = (getHeight() - dp(36)) / 2;
        cancelButton.layout(offset + dp(4), y, offset + dp(40), y + dp(36));
        stopButton.layout(offset + width - dp(40), y, offset + width - dp(4), y + dp(36));
        float density = getResources().getDisplayMetrics().density;
        if (state == State.ERROR && (width != errorLineWidth || density != errorLineDensity || !errorText.equals(errorLineText))) {
            text.setTextSize(dp(13));
            errorLine = TextUtils.ellipsize(errorText, text, Math.max(0, width - dp(4 + 36 + 10 + 12)), TextUtils.TruncateAt.END).toString();
            errorLineWidth = width;
            errorLineDensity = density;
            errorLineText = errorText;
        }
        cancelButton.setAlpha(contentAlpha());
        stopButton.setAlpha(contentAlpha());
    }

    private int gamma(double x) { return (int) Math.max(0, Math.min(255, 255 * (x <= .0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - .055))); }

    /** Steps the Aura on (dt seconds) and draws it into its small bitmap; false when it has nothing to show. */
    private boolean stepAura(float w, float h) {
        long now = SystemClock.uptimeMillis();
        float dt = auraLast == 0 ? 0 : Math.min(.1f, (now - auraLast) / 1000f);
        auraLast = now;
        float target = state == State.RECORDING ? 1 : 0;
        auraShown += Math.signum(target - auraShown) * Math.min(Math.abs(target - auraShown), dt / (target > 0 ? .35f : .5f));
        auraLevel += (level - auraLevel) * Math.min(1, dt / .12f);
        if (auraShown <= 0 && target == 0) { auraLast = 0; return false; }
        int gw = 64, gh = Math.max(4, Math.round(64 * h / Math.max(1, w)));
        if (aura == null) {
            aura = Bitmap.createBitmap(gw, gh, Bitmap.Config.ARGB_8888);
            auraPixels = new int[gw * gh];
        }
        float lv = auraLevel, aspect = (float) gw / gh;
        int n = blobs.length;

        for (int i = 0; i < n; i++) {
            float[] blob = blobs[i];
            turns[i] += AURA_TEMPO * dt * (2 * (float) Math.PI / blob[4]) * (1 + 1.5f * lv);
            double t = turns[i], from = Math.toRadians(blob[0]), reach = AURA_SCALE * .38 * (.9 + lv * blob[5] + .25 * Math.sin(2 * t));
            bx[i] = (float) (.5 + .32 * Math.cos(from) + .14 * Math.cos(t));
            by[i] = (float) (.5 + .36 * Math.sin(from) + .26 * Math.sin(t));
            br[i] = (float) Math.pow(Math.max(.06 * AURA_SCALE, reach), 2);
            bl[i] = blob[1] + .05f * lv; bc[i] = blob[2];
            ba[i] = (float) Math.cos(Math.toRadians(blob[3])); bb[i] = (float) Math.sin(Math.toRadians(blob[3]));
        }
        // A faint ground of the middle hue everywhere, so two far hues meeting settle through it.
        float gw0 = .18f, ga = (float) Math.cos(Math.toRadians(345)), gb = (float) Math.sin(Math.toRadians(345));
        for (int y = 0; y < gh; y++) for (int x = 0; x < gw; x++) {
            float u = (x + .5f) / gw, v = (y + .5f) / gh;
            float sw = gw0, sl = gw0 * .62f, sc = gw0 * .2f, sa = gw0 * ga, sb = gw0 * gb;
            for (int i = 0; i < n; i++) {
                float dx = (u - bx[i]) * Math.min(1, aspect), dy = (v - by[i]) * Math.min(1, 1 / aspect);
                float k = (float) Math.exp(-(dx * dx + dy * dy) / br[i]);
                sw += k; sl += k * bl[i]; sc += k * bc[i]; sa += k * ba[i]; sb += k * bb[i];
            }
            double norm = Math.hypot(sa, sb), c = sc / sw, L = sl / sw, A = c * sa / (norm == 0 ? 1 : norm), B = c * sb / (norm == 0 ? 1 : norm);
            double l_ = L + .3963377774 * A + .2158037573 * B, m_ = L - .1055613458 * A - .0638541728 * B, s_ = L - .0894841775 * A - 1.291485548 * B;
            double lc = l_ * l_ * l_, mc = m_ * m_ * m_, sc3 = s_ * s_ * s_;
            auraPixels[y * gw + x] = 0xff000000 | gamma(4.0767416621 * lc - 3.3077115913 * mc + .2309699292 * sc3) << 16
                | gamma(-1.2684380046 * lc + 2.6097574011 * mc - .3413193965 * sc3) << 8 | gamma(-.0041960863 * lc - .7034186147 * mc + 1.707614701 * sc3);
        }
        aura.setPixels(auraPixels, 0, gw, 0, 0, gw, gh);
        return true;
    }

    @Override protected void onDraw(Canvas canvas) {
        float w = getWidth(), h = getHeight();
        boolean right = window.prefs().getBoolean("right", true);
        // The Aura under everything, clipped to the pill, with the frost's sheen and lit rim over it.
        if (stepAura(w, h)) {
            float rr = Math.min(w, h) / 2;
            clip.reset();
            clip.addRoundRect(0, 0, w, h, rr, rr, Path.Direction.CW);
            canvas.save();
            canvas.clipPath(clip);
            auraPaint.setAlpha(Math.round(255 * auraShown * Math.min(1, window.openness)));
            canvas.drawBitmap(aura, null, auraBounds, auraPaint);
            int sheen = Math.round(26 * auraShown);
            if (sheen != sheenBucket) {
                sheenBucket = sheen;
                sheenGradient = new android.graphics.LinearGradient(0, 0, 0, h * .6f,
                    Color.argb(sheen, 255, 255, 255), 0, android.graphics.Shader.TileMode.CLAMP);
            }
            paint.setShader(sheenGradient);
            canvas.drawRect(0, 0, w, h, paint);
            paint.setShader(null);
            // The inset glow (white 14%, reaching .3 of the pill's height), as stacked strokes fading inward.
            paint.setStyle(Paint.Style.STROKE);
            float reach = .3f * h;
            for (int i = 0; i < 6; i++) {
                float d = reach * (i + .5f) / 6, sw = reach / 6;
                paint.setStrokeWidth(sw);
                paint.setColor(Color.argb(Math.round(36 * auraShown * (1 - (i + .5f) / 6)), 255, 255, 255));
                canvas.drawRoundRect(d, d, w - d, h - d, Math.max(0, rr - d), Math.max(0, rr - d), paint);
            }
            paint.setStyle(Paint.Style.FILL);
            canvas.restore();
            postInvalidateOnAnimation();
        }
        // The frost (fill, its one stroke, the blur) is the window's background; this draws only what sits on it.
        // A soft top highlight, inside the stroke, as v2's inset 0 1px 0 white 50%.
        float r = Math.min(w, h) / 2, inset = dp(1);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(1));
        paint.setShader(highlight);
        canvas.drawRoundRect(inset + dp(.5f), inset + dp(.5f), w - inset - dp(.5f), h - inset - dp(.5f), r - inset, r - inset, paint);
        paint.setShader(null);
        paint.setStyle(Paint.Style.FILL);
        // At rest: the Conduit mark in the bubble's middle, fading as it opens.
        if (window.openness < 1) {
            mark.setAlpha(Math.round(235 * (1 - Math.min(1, window.openness / .45f))));
            float cx = right ? w - dp(HANDLE_W) / 2f : dp(HANDLE_W) / 2f;
            // With captures held, the mark steps down and smaller to make room for their count above it.
            float half = dp(gathered > 0 ? 9 : 12), cy = h / 2 + (gathered > 0 ? dp(5) : 0);
            mark.setBounds(Math.round(cx - half), Math.round(cy - half), Math.round(cx + half), Math.round(cy + half));
            mark.draw(canvas);
            if (gathered > 0) {
                float by = dp(10), radius = dp(7);
                int fade = Math.round(255 * (1 - Math.min(1, window.openness / .45f)));
                badgePaint.setColor(0xffe8e9eb);
                badgePaint.setAlpha(fade);
                canvas.drawCircle(cx, by, radius, badgePaint);
                badgeText.setTextSize(dp(10));
                badgeText.setFakeBoldText(true);
                badgeText.setColor(0xff141518);
                badgeText.setAlpha(fade);
                String count = gathered > 9 ? "9+" : String.valueOf(gathered);
                canvas.drawText(count, cx - badgeText.measureText(count) / 2, by - (badgeText.ascent() + badgeText.descent()) / 2, badgeText);
            }
        }
        if (state == State.HANDLE) return;
        int width = window.controlWidth();
        float offset = right ? w - width : 0;
        int alpha = Math.round(255 * contentAlpha());
        // The middle: after cancel (ends at 40) and the target glyph (40 + 26), before send (width - 40).
        float from = offset + dp(46), to = offset + width - dp(46), mid = (from + to) / 2;
        if (state == State.RECORDING) {
            paint.setColor(Color.argb(alpha, 232, 233, 235));
            int bars = 7;
            float bar = dp(3), gap = dp(4), span = bars * bar + (bars - 1) * gap, x = mid - span / 2;
            for (int i = 0; i < bars; i++) {
                float weight = 1 - Math.abs(i - (bars - 1) / 2f) / ((bars + 1) / 2f);
                // Each bar breathes on its own beat, so even steady speech moves the row.
                float wobble = .7f + .3f * (float) Math.sin(SystemClock.uptimeMillis() / 1000f * (7 + 2.3f * i) + i * 1.7f);
                float tall = Math.min(h - dp(14), dp(4) + dp(26) * auraLevel * (.4f + .6f * weight) * wobble);
                canvas.drawRoundRect(x, (h - tall) / 2, x + bar, (h + tall) / 2, bar / 2, bar / 2, paint);
                x += bar + gap;
            }
        } else if (state == State.STOPPING || state == State.SENDING) {
            // The small bubble: a light spinner in its middle.
            paint.setColor(Color.argb(Math.round(alpha * .9f), 232, 233, 235));
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(2));
            paint.setStrokeCap(Paint.Cap.ROUND);
            float cx = offset + width / 2f;
            canvas.drawArc(cx - dp(8), h / 2 - dp(8), cx + dp(8), h / 2 + dp(8), (SystemClock.uptimeMillis() % 900) * .4f, 250, false, paint);
            paint.setStrokeCap(Paint.Cap.BUTT);
            paint.setStyle(Paint.Style.FILL);
            postInvalidateOnAnimation();
        } else if (state == State.SENT) {
            // The tick draws itself on (220ms, decelerating), then holds until Float goes back to rest.
            float t = Math.min(1, (SystemClock.uptimeMillis() - sentAt) / 220f), drawn = 1 - (1 - t) * (1 - t) * (1 - t);
            float cx = offset + width / 2f, cy = h / 2;
            tickPart.rewind();
            tickMeasure.getSegment(0, tickMeasure.getLength() * drawn, tickPart, true);
            paint.setColor(Color.argb(alpha, 232, 233, 235));
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(dp(2.25f));
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            canvas.save();
            canvas.translate(cx, cy);
            canvas.drawPath(tickPart, paint);
            canvas.restore();
            paint.setStrokeCap(Paint.Cap.BUTT);
            paint.setStrokeJoin(Paint.Join.MITER);
            paint.setStyle(Paint.Style.FILL);
            if (t < 1) postInvalidateOnAnimation();
        } else if (state == State.ERROR) {
            text.setTextSize(dp(13));
            text.setColor(Color.argb(alpha, 232, 233, 235));
            canvas.drawText(errorLine, offset + dp(50), h / 2 - (text.ascent() + text.descent()) / 2, text);
        }
    }

    @Override public void onInitializeAccessibilityNodeInfo(android.view.accessibility.AccessibilityNodeInfo info) {
        super.onInitializeAccessibilityNodeInfo(info);
        if (state != State.HANDLE) info.addAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_DISMISS);
    }
    @Override public boolean performAccessibilityAction(int action, android.os.Bundle arguments) {
        if (action == android.view.accessibility.AccessibilityNodeInfo.ACTION_DISMISS) { listener.onCancel(); return true; }
        return super.performAccessibilityAction(action, arguments);
    }
    @Override public boolean performClick() {
        super.performClick();
        if (state == State.HANDLE) listener.onTap();
        else if (state == State.ERROR) listener.onRetry();
        return true;
    }

    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            window.startDrag();
            downX = event.getRawX(); downY = event.getRawY(); initialY = window.top();
            initialX = window.left();
            dragging = false; moved = false; holding = false;
            window.lift(true);
            removeCallbacks(holdStart);
            if (state == State.HANDLE && window.prefs().getBoolean("holdToTalk", false)) postDelayed(holdStart, HOLD_MS);
        } else if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
            float distance = (float) Math.hypot(event.getRawX() - downX, event.getRawY() - downY);
            if (distance > ViewConfiguration.get(getContext()).getScaledTouchSlop() && !holding) {
                moved = true;
                removeCallbacks(holdStart);
            }
            if (moved && state == State.HANDLE && !holding) dragging = true;
            if (dragging || distance > dp(60)) return true;
        }
        return super.onInterceptTouchEvent(event);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: return true;
            case MotionEvent.ACTION_MOVE:
                if (holding) { listener.onHoldMove(event.getRawX(), event.getRawY()); return true; }
                float distance = (float) Math.hypot(event.getRawX() - downX, event.getRawY() - downY);
                if (distance > ViewConfiguration.get(getContext()).getScaledTouchSlop()) {
                    moved = true;
                    removeCallbacks(holdStart);
                    if (state == State.HANDLE) dragging = true;
                }
                if (dragging) {
                    window.dragTo(initialX + Math.round(event.getRawX() - downX),
                        initialY + Math.round(event.getRawY() - downY));
                }
                return true;
            case MotionEvent.ACTION_UP:
                removeCallbacks(holdStart);
                window.lift(false);
                // Let go after dragging well away from where the hold began: cancelled.
                if (holding) { holding = false; listener.onHoldEnd(Math.hypot(event.getRawX() - downX, event.getRawY() - downY) > dp(80)); return true; }
                if (dragging) listener.onDragEnded();
                else if (state != State.HANDLE && Math.hypot(event.getRawX() - downX, event.getRawY() - downY) > dp(60)) listener.onCancel();
                else if (!moved) performClick();
                return true;
            case MotionEvent.ACTION_CANCEL:
                removeCallbacks(holdStart);
                window.lift(false);
                if (holding) { holding = false; listener.onHoldEnd(true); return true; }
                if (dragging) listener.onDragEnded();
                dragging = false;
                return true;
            default: return true;
        }
    }
}
