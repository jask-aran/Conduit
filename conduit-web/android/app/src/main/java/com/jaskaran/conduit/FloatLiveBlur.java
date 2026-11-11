package com.jaskaran.conduit;

import android.os.Build;
import android.util.Log;
import android.view.View;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/** One UI's SemBlurInfo, by reflection: a live blur on devices that report no cross-window blur. */
final class FloatLiveBlur {
    private static final String TAG = "FloatLiveBlur";
    private static Constructor<?> builder;
    private static Method radius, colour, corner, build, set;
    private static int windowMode;
    private static final boolean AVAILABLE = init();
    private static final java.util.Map<View, long[]> applied = new java.util.WeakHashMap<>();

    private FloatLiveBlur() {}

    private static boolean init() {
        if (Build.VERSION.SDK_INT < 31) return false;
        try {
            Class<?> info = Class.forName("android.view.SemBlurInfo");
            Class<?> b = Class.forName("android.view.SemBlurInfo$Builder");
            builder = b.getDeclaredConstructor(int.class);
            builder.setAccessible(true);
            radius = method(b, "setRadius", int.class);
            colour = method(b, "setBackgroundColor", int.class);
            corner = method(b, "setBackgroundCornerRadius", float.class);
            build = method(b, "build");
            set = method(View.class, "semSetBlurInfo", info);
            windowMode = info.getField("BLUR_MODE_WINDOW").getInt(null);
            return build != null && set != null;
        } catch (Throwable error) {
            Log.i(TAG, "no SemBlurInfo: " + error);
            return false;
        }
    }

    private static Method method(Class<?> owner, String name, Class<?>... args) {
        for (String candidate : new String[] { "hidden_" + name, name }) {
            try {
                Method m = owner.getMethod(candidate, args);
                m.setAccessible(true);
                return m;
            } catch (Throwable ignored) {}
        }
        return null;
    }

    static boolean available() { return AVAILABLE; }

    /** Matches the screenshot frost's blur (FloatFrost.blur at 1/8 scale) within 1/255, measured on a phone. */
    static int radius(android.content.Context context) { return Math.round(21.33f * context.getResources().getDisplayMetrics().density); }

    /** FloatFrost's LIFT, so the handle, slots and caption are as bright as each other. */
    static final int LIFT = 0x8c3a3b3f;

    /**
     * Samsung's blur takes the place of the window's background drawable, so the frost moves onto the content. No
     * elevation: a shadow cast by glass shows through it, and the window has no room outside it.
     */
    static boolean frost(android.view.Window window, View content, android.graphics.drawable.Drawable frost) {
        if (!AVAILABLE) return false;
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        content.setBackground(frost);
        content.setElevation(0);
        window.getDecorView().setElevation(0);
        return true;
    }

    static boolean apply(View view, int radiusPx, int tint, float cornerPx) {
        if (!AVAILABLE) return false;
        long[] last = applied.get(view);
        int cornerBits = Float.floatToIntBits(cornerPx);
        if (last != null && last[0] == radiusPx && last[1] == tint && last[2] == cornerBits) return true;
        try {
            Object b = builder.newInstance(windowMode);
            if (radius != null) radius.invoke(b, radiusPx);
            if (colour != null) colour.invoke(b, tint);
            if (corner != null) corner.invoke(b, cornerPx);
            set.invoke(view, build.invoke(b));
            // Record only a successful apply so a failed call can retry.
            applied.put(view, new long[] { radiusPx, tint, cornerBits });
            return true;
        } catch (Throwable error) {
            Log.w(TAG, "SemBlurInfo failed", error);
            return false;
        }
    }

    private static Method clipPath;
    /** One region for several shapes: One UI ignores every blur region past its small limit. */
    static boolean applyPath(View view, int radiusPx, android.graphics.Path path) {
        if (!AVAILABLE) return false;
        try {
            if (clipPath == null) clipPath = method(Class.forName("android.view.SemBlurInfo$Builder"), "setBackgroundClipPath", android.graphics.Path.class);
            Object b = builder.newInstance(windowMode);
            if (radius != null) radius.invoke(b, radiusPx);
            if (colour != null) colour.invoke(b, android.graphics.Color.TRANSPARENT);
            if (clipPath != null) clipPath.invoke(b, path);
            set.invoke(view, build.invoke(b));
            applied.remove(view);
            return clipPath != null;
        } catch (Throwable error) {
            Log.w(TAG, "SemBlurInfo path failed", error);
            return false;
        }
    }

    static void clear(View view) {
        applied.remove(view);
        if (!AVAILABLE) return;
        try { set.invoke(view, (Object) null); } catch (Throwable ignored) {}
    }
}
