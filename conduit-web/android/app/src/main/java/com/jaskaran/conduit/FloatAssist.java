package com.jaskaran.conduit;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import java.util.function.Consumer;

/** Main thread only. */
final class FloatAssist {
    private FloatAssist() {}
    private static Consumer<ConduitContext.Result> receiver;
    private static ConduitContext.Result pending;

    static void receive(Consumer<ConduitContext.Result> next) {
        receiver = next;
        if (next != null && pending != null) { ConduitContext.Result held = pending; pending = null; next.accept(held); }
    }

    static void deliver(Context context, ConduitContext.Result result) {
        // The assistant's session is on screen, which lets Float hold the microphone: a Float restored at boot (or
        // started by this press) has none until then, and its dictation would open the app instead.
        if (receiver != null && !ConduitFloatService.microphoneReadyNow()) startVisible(context);
        if (receiver != null) { receiver.accept(result); return; }
        if (pending != null && pending.image != null) pending.image.delete();
        pending = result;
        if (!ConduitFloatPlugin.preferences(context).getBoolean("enabled", false)) return;
        startVisible(context);
    }

    private static void startVisible(Context context) {
        Intent start = new Intent(context, ConduitFloatService.class).setAction(ConduitFloatService.VISIBLE);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(start);
            else context.startService(start);
        } catch (RuntimeException notAllowed) { /* Float comes back when the app next opens; the capture waits. */ }
    }

    static boolean floatOn(Context context) { return ConduitFloatPlugin.preferences(context).getBoolean("enabled", false); }
}
