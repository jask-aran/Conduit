package com.jaskaran.conduit;

import android.os.Build;
import android.util.Log;
import android.view.View;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/**
 * Samsung's own live blur behind a view (One UI's SemBlurInfo, reached by reflection): it blurs whatever is behind the
 * view's rounded rect, every frame, on devices that report no cross-window blur. Elsewhere it is simply unavailable.
 */
final class FloatLiveBlur {
    private static final String TAG = "FloatLiveBlur";
    private static Constructor<?> builder;
    private static Method radius, colour, corner, build, set;
    private static int windowMode;
    private static final boolean AVAILABLE = init();

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

    /** Blurs what is behind view by radiusPx, tinted (an ARGB laid over the blur), in a rect of cornerPx corners. */
    static boolean apply(View view, int radiusPx, int tint, float cornerPx) {
        if (!AVAILABLE) return false;
        try {
            Object b = builder.newInstance(windowMode);
            if (radius != null) radius.invoke(b, radiusPx);
            if (colour != null) colour.invoke(b, tint);
            if (corner != null) corner.invoke(b, cornerPx);
            set.invoke(view, build.invoke(b));
            return true;
        } catch (Throwable error) {
            Log.w(TAG, "SemBlurInfo failed", error);
            return false;
        }
    }

    static void clear(View view) {
        if (!AVAILABLE) return;
        try { set.invoke(view, (Object) null); } catch (Throwable ignored) {}
    }
}
