package com.jaskaran.conduit;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import java.util.function.Consumer;

/**
 * Hand-off from Conduit's assistant (a long press on home) to Float: the screen the assistant was given arrives as a
 * capture, and Float holds it and opens its radial to choose where it goes. Main thread only.
 */
final class FloatAssist {
    private FloatAssist() {}
    private static Consumer<ConduitContext.Result> receiver;
    private static ConduitContext.Result pending;

    /** Float's service registers while it runs (null when it stops); a capture waiting for it is handed over at once. */
    static void receive(Consumer<ConduitContext.Result> next) {
        receiver = next;
        if (next != null && pending != null) { ConduitContext.Result held = pending; pending = null; next.accept(held); }
    }

    /** From the assistant session: to Float if it runs; else held, and Float is started when it is turned on. */
    static void deliver(Context context, ConduitContext.Result result) {
        if (receiver != null) { receiver.accept(result); return; }
        if (pending != null && pending.image != null) pending.image.delete();
        pending = result;
        if (!ConduitFloatPlugin.preferences(context).getBoolean("enabled", false)) return;
        Intent start = new Intent(context, ConduitFloatService.class).setAction(ConduitFloatService.RESTORE);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(start);
            else context.startService(start);
        } catch (RuntimeException notAllowed) { /* Float comes back when the app next opens; the capture waits. */ }
    }

    static boolean floatOn(Context context) { return ConduitFloatPlugin.preferences(context).getBoolean("enabled", false); }
}
