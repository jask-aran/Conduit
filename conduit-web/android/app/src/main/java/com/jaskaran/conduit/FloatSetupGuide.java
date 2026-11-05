package com.jaskaran.conduit;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import java.util.function.BooleanSupplier;

/**
 * Float's setup, while a step's Settings page is open: a toast saying what to tap there, and a watch for the step
 * being done that brings Conduit straight back. Settings lets no app open its own Accessibility entry or point at a
 * row, and hides every app's overlay over these pages (they are guarded against tapjacking), so a toast, which the
 * system draws, is the one way to say it there. Main thread only.
 */
final class FloatSetupGuide {
    private static final long POLL_MS = 300, GIVE_UP_MS = 5 * 60_000;
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private BooleanSupplier done;
    private Runnable finished;
    private long since;

    FloatSetupGuide(Context context) { this.context = context.getApplicationContext(); }

    /** line: what to tap (none for a page that says it itself). done, when not null, is watched; true runs finished. */
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

    /** Brings Conduit back over the Settings page: it closes what it opened, so the step's result comes through. */
    static void returnToApp(Context context) {
        context.startActivity(new android.content.Intent(context, MainActivity.class)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP
                | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }
}
