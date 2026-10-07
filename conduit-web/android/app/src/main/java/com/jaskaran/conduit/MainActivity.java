package com.jaskaran.conduit;

import android.os.Bundle;

import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Whether the page has loaded, scripts and all, and so is drawing the same
    // mark on the same frame as the launch screen. Its first commit was too
    // early: a blank frame came before the mark.
    private volatile boolean pageVisible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /*
         * The launch screen, held until the page has drawn.
         *
         * Without this the system took it down at the activity's first frame,
         * which is the WebView's default white before index.html has painted:
         * a white flash between two dark screens. Installing it also applies
         * `postSplashScreenTheme`, which nothing did before. Two seconds is a
         * ceiling for a page that never commits, not a wait.
         */
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        long shownAt = android.os.SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(() -> !pageVisible && android.os.SystemClock.uptimeMillis() - shownAt < 2000);
        /*
         * And kept over the window until the WebView has drawn into it. The
         * WebView does not draw while the system's launch window covers the
         * app, so taking the splash down outright showed the bare frame for
         * a few hundred milliseconds before the page's own mark. The splash
         * is handed into the window instead, the WebView is asked to say when
         * what it holds is on screen, and only then does the splash fade.
         */
        splash.setOnExitAnimationListener(view -> {
            Runnable fade = new Runnable() {
                private boolean done;
                @Override public void run() {
                    if (done) return;
                    done = true;
                    view.getView().animate().alpha(0f).setDuration(120).withEndAction(view::remove).start();
                }
            };
            getBridge().getWebView().postVisualStateCallback(0, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) { fade.run(); }
            });
            view.getView().postDelayed(fade, 1000);
        });
        // Registered before the bridge is built, which is the only point at
        // which a plugin living in the app rather than in a package can be
        // added to it.
        registerPlugin(ConduitDiscoveryPlugin.class);
        registerPlugin(ConduitKeyboardPlugin.class);
        registerPlugin(ConduitTlsPlugin.class);
        registerPlugin(ConduitUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        /*
         * Take the window out of legacy soft-input handling.
         *
         * Left in it, Android resizes the window for the keyboard itself, in
         * one step, and runs no inset animation -- so a
         * `WindowInsetsAnimationCompat` callback is installed correctly and
         * never called once. Opting out is what turns the keyboard into an
         * animated inset that `ConduitKeyboardPlugin` can follow frame by
         * frame, and it is also what lets the keyboard overlay the page rather
         * than shorten it, leaving the shell's height to the page.
         */
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        /*
         * Installed after the bridge is built, because the bridge installs its
         * own client as it builds and this one has to replace it rather than
         * be replaced by it. It is that same client with one method added --
         * subclassed rather than written fresh, since everything else the
         * bridge does on a page load still has to happen.
         */
        getBridge().setWebViewClient(new ConduitWebViewClient(getBridge()));
        // The frame, not white, under anything the page has not drawn yet.
        getBridge().getWebView().setBackgroundColor(getColor(R.color.conduit_frame));
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) { pageVisible = true; }
        });
        /*
         * Identities handed in at launch, for a development build only, as
         * `id:spkiBase64` pairs separated by commas.
         *
         * The real set arrives from the page's paired server records. This
         * lets a build under test reach a server's TLS port before it has
         * paired, and it is gated on the app being debuggable because a key
         * any launcher can set is a key anything on the device can set.
         */
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            String trust = getIntent() == null ? null : getIntent().getStringExtra("conduitTrust");
            if (trust != null && !trust.isEmpty()) {
                java.util.Map<String, String> identities = new java.util.HashMap<>();
                for (String pair : trust.split(",")) {
                    int colon = pair.indexOf(':');
                    if (colon > 0) identities.put(pair.substring(0, colon), pair.substring(colon + 1));
                }
                ConduitWebViewClient.trust(identities);
            }
        }
    }
}
