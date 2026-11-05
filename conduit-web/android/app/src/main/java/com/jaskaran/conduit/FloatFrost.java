package com.jaskaran.conduit;

import android.graphics.Canvas;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import androidx.core.graphics.ColorUtils;

/**
 * v2's .ui-frost for Float's own windows, the native phone composer's recipe (ConduitComposerPlugin.Frost): the fill is
 * white at 17% (--frost-fill) over the ground, a hairline of white at 30% over that fill, and the inset highlights,
 * white at 50% on top and 10% underneath, starting inside the border. There is no sheen gradient.
 *
 * Float floats over other apps, not over Conduit's page, so its ground is not known: with the system's cross-window
 * blur on, the window blurs what is behind it and the ground is the dark core at 50% over that blur (so what is behind
 * still reads through, as it does behind the app's popovers); without it the
 * ground is the composer's own page sample (#131216), giving the composer's flat #3b3a3d. The window's blur follows
 * this drawable's outline, so it reports its rounded rect.
 */
final class FloatFrost extends Drawable {
    private static final int GROUND = 0xff131216, GROUND_OVER_BLUR = 0x80131216, FILL = 0x2bffffff;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF box = new RectF();
    private final Path inside = new Path(), shifted = new Path(), highlight = new Path();
    private final float line;
    /** Corner radius in pixels; a negative radius is fully round (half the short side). */
    private final float radius;
    private boolean blurred;
    private int alpha = 255;
    /** A blurred screenshot at 1/BACKDROP_SCALE size, and where this drawable's window sits on screen. */
    private android.graphics.Bitmap backdrop;
    private int originX, originY;
    static final int BACKDROP_SCALE = 8;
    private final Paint backdropPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final android.graphics.Rect source = new android.graphics.Rect();
    private final Path clip = new Path();

    /**
     * Lifted: Float's own controls (the radial's slots), as bright as its handle: over the blurred screen, the
     * handle's ground (#3a3b3f) at 80% before the white fill, so a dark screen behind does not sink them.
     */
    private boolean lifted;
    /** Over Samsung's live blur (FloatLiveBlur), which carries the ground as its tint: only the white fill is drawn. */
    private boolean live;
    void setLive(boolean live) { this.live = live; invalidateSelf(); }
    void setLifted(boolean lifted) { this.lifted = lifted; invalidateSelf(); }
    private static final int LIFT = 0x8c3a3b3f;

    /** Draws this blurred screenshot behind the frost, as backdrop-filter does; null goes back to the ground. */
    void setBackdrop(android.graphics.Bitmap blurredScreen) { backdrop = blurredScreen; invalidateSelf(); }
    /** Where the window's top-left is on screen, in pixels, so the right part of the backdrop shows. */
    void setOrigin(int x, int y) { if (x != originX || y != originY) { originX = x; originY = y; invalidateSelf(); } }

    /** Three box passes over the bitmap in place, horizontally then vertically each time: close to a Gaussian. */
    static void blur(android.graphics.Bitmap bitmap, int radius) {
        int w = bitmap.getWidth(), h = bitmap.getHeight();
        int[] a = new int[w * h], b = new int[w * h];
        bitmap.getPixels(a, 0, w, 0, 0, w, h);
        for (int pass = 0; pass < 3; pass++) { box(a, b, w, h, radius, true); box(b, a, w, h, radius, false); }
        bitmap.setPixels(a, 0, w, 0, 0, w, h);
    }

    private static void box(int[] in, int[] out, int w, int h, int r, boolean horizontal) {
        int lines = horizontal ? h : w, length = horizontal ? w : h, span = 2 * r + 1;
        for (int line = 0; line < lines; line++) {
            int sr = 0, sg = 0, sb = 0;
            for (int k = -r; k <= r; k++) {
                int c = in[index(line, Math.max(0, Math.min(length - 1, k)), w, horizontal)];
                sr += (c >> 16) & 255; sg += (c >> 8) & 255; sb += c & 255;
            }
            for (int i = 0; i < length; i++) {
                out[index(line, i, w, horizontal)] = 0xff000000 | (sr / span) << 16 | (sg / span) << 8 | (sb / span);
                int add = in[index(line, Math.min(length - 1, i + r + 1), w, horizontal)];
                int drop = in[index(line, Math.max(0, i - r), w, horizontal)];
                sr += ((add >> 16) & 255) - ((drop >> 16) & 255);
                sg += ((add >> 8) & 255) - ((drop >> 8) & 255);
                sb += (add & 255) - (drop & 255);
            }
        }
    }

    private static int index(int line, int i, int w, boolean horizontal) { return horizontal ? line * w + i : i * w + line; }

    FloatFrost(float radius, float hairline) { this.radius = radius; this.line = Math.max(1, hairline); }

    void setBlurred(boolean blurred) { if (this.blurred != blurred) { this.blurred = blurred; invalidateSelf(); } }

    private float corner() {
        return radius < 0 ? Math.min(getBounds().width(), getBounds().height()) / 2f : radius;
    }

    private int fill() { if (live) return FILL; return ColorUtils.compositeColors(FILL, lifted ? 0xfa3a3b3f : blurred ? GROUND_OVER_BLUR : GROUND); }

    private int faded(int colour) { return ColorUtils.setAlphaComponent(colour, Math.round((colour >>> 24) * alpha / 255f)); }

    @Override public void draw(Canvas canvas) {
        float r = corner();
        box.set(getBounds());
        if (!live && backdrop != null && !backdrop.isRecycled()) { drawOverBackdrop(canvas, r); return; }
        int fill = fill();
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(faded(fill));
        canvas.drawRoundRect(box, r, r, paint);
        box.inset(line / 2, line / 2);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(line);
        paint.setColor(faded(ColorUtils.compositeColors(0x4dffffff, fill)));
        canvas.drawRoundRect(box, Math.max(0, r - line / 2), Math.max(0, r - line / 2), paint);
        box.inset(line / 2, line / 2);
        inside.reset();
        inside.addRoundRect(box, Math.max(0, r - line), Math.max(0, r - line), Path.Direction.CW);
        // CSS inset shadows: the rounded box less itself moved by one line, so the highlight follows the curve.
        paint.setStyle(Paint.Style.FILL);
        shifted.set(inside); shifted.offset(0, line); highlight.set(inside); highlight.op(shifted, Path.Op.DIFFERENCE);
        paint.setColor(faded(ColorUtils.compositeColors(0x80ffffff, fill)));
        canvas.drawPath(highlight, paint);
        shifted.set(inside); shifted.offset(0, -line); highlight.set(inside); highlight.op(shifted, Path.Op.DIFFERENCE);
        paint.setColor(faded(ColorUtils.compositeColors(0x1affffff, fill)));
        canvas.drawPath(highlight, paint);
    }

    /** .ui-frost over a real backdrop: the blurred screen, white 17% over it, the hairline and highlights as tints. */
    private void drawOverBackdrop(Canvas canvas, float r) {
        android.graphics.Rect bounds = getBounds();
        clip.reset();
        clip.addRoundRect(box, r, r, Path.Direction.CW);
        canvas.save();
        canvas.clipPath(clip);
        source.set((originX + bounds.left) / BACKDROP_SCALE, (originY + bounds.top) / BACKDROP_SCALE,
            (originX + bounds.right + BACKDROP_SCALE - 1) / BACKDROP_SCALE, (originY + bounds.bottom + BACKDROP_SCALE - 1) / BACKDROP_SCALE);
        backdropPaint.setAlpha(alpha);
        canvas.drawBitmap(backdrop, source, bounds, backdropPaint);
        paint.setStyle(Paint.Style.FILL);
        if (lifted) { paint.setColor(faded(LIFT)); canvas.drawRect(bounds, paint); }
        paint.setColor(faded(FILL));
        canvas.drawRect(bounds, paint);
        canvas.restore();
        box.inset(line / 2, line / 2);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(line);
        paint.setColor(faded(0x4dffffff));
        canvas.drawRoundRect(box, Math.max(0, r - line / 2), Math.max(0, r - line / 2), paint);
        box.inset(line / 2, line / 2);
        inside.reset();
        inside.addRoundRect(box, Math.max(0, r - line), Math.max(0, r - line), Path.Direction.CW);
        paint.setStyle(Paint.Style.FILL);
        shifted.set(inside); shifted.offset(0, line); highlight.set(inside); highlight.op(shifted, Path.Op.DIFFERENCE);
        paint.setColor(faded(0x80ffffff));
        canvas.drawPath(highlight, paint);
        shifted.set(inside); shifted.offset(0, -line); highlight.set(inside); highlight.op(shifted, Path.Op.DIFFERENCE);
        paint.setColor(faded(0x1affffff));
        canvas.drawPath(highlight, paint);
    }

    @Override public void getOutline(Outline outline) {
        outline.setRoundRect(getBounds(), corner());
        outline.setAlpha(1); // a translucent fill must not suppress the lift shadow
    }

    @Override public void setAlpha(int alpha) { this.alpha = alpha; invalidateSelf(); }
    @Override public void setColorFilter(android.graphics.ColorFilter filter) {}
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
}
