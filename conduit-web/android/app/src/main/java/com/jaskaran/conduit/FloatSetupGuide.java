package com.jaskaran.conduit;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import java.util.function.BooleanSupplier;

/**
 * Settings hides every app's overlay over these pages (tapjacking guard), so a toast, which the system draws, is the
 * one way to say what to tap there. Main thread only.
 */
final class FloatSetupGuide {
    private static final long POLL_MS = 300, GIVE_UP_MS = 5 * 60_000;
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private BooleanSupplier done;
    private Runnable finished;
    private long since;

    FloatSetupGuide(Context context) { this.context = context.getApplicationContext(); }

    void show(String line, BooleanSupplier done, Runnable finished) {
        hide();
        if (line != null && !line.isEmpty()) Toast.makeText(context, line, Toast.LENGTH_LONG).show();
        if (done == null) return;
        this.done = done;
        this.finished = finished;
        since = android.os.SystemClock.uptimeMillis();
        main.postDelayed(poll, POLL_MS);
    }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (done == null) return;
            if (done.getAsBoolean()) {
                Runnable then = finished;
                hide();
                if (then != null) then.run();
                return;
            }
            // Left on another app or forgotten: stop watching rather than pull Conduit up much later.
            if (android.os.SystemClock.uptimeMillis() - since > GIVE_UP_MS) { hide(); return; }
            main.postDelayed(this, POLL_MS);
        }
    };

    void hide() {
        main.removeCallbacks(poll);
        done = null;
        finished = null;
    }

    /** Closes what it opened, so the step's result comes through. */
    static void returnToApp(Context context) {
        context.startActivity(new android.content.Intent(context, MainActivity.class)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
                | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }
}
