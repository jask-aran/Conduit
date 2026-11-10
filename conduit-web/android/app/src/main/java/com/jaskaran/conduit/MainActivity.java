package com.jaskaran.conduit;

import android.os.Bundle;
import android.content.Intent;

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
        // A live-updated interface that never said it started is put back to
        // the bundled one before the bridge reads which one to load.
        ConduitUpdaterPlugin.revertUnconfirmed(this);
        registerPlugin(ConduitDiscoveryPlugin.class);
        registerPlugin(ConduitKeyboardPlugin.class);
        registerPlugin(ConduitAudioPlugin.class);
        registerPlugin(ConduitFloatPlugin.class);
        registerPlugin(ConduitHapticsPlugin.class);
        registerPlugin(ConduitPhotosPlugin.class);
        registerPlugin(ConduitCameraPlugin.class);
        registerPlugin(ConduitComposerPlugin.class);
        registerPlugin(ConduitTlsPlugin.class);
        registerPlugin(ConduitUpdaterPlugin.class);
        registerPlugin(ConduitPushPlugin.class);
        registerPlugin(ConduitLoopbackPlugin.class);
        ConduitPushPlugin.handleIntent(this, getIntent());
        super.onCreate(savedInstanceState);
        /*
         * The status bar gets the system's own see-through scrim, as the
         * navigation bar has by default (its contrast is enforced, the
         * status bar's is not): edge to edge, the page runs under both, and
         * without it the clock and icons sat on whatever scrolled past.
         */
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(true);
            getWindow().setNavigationBarContrastEnforced(true);
        }
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
        /*
         * The page's renderer at the app's own priority, hidden or not. By default it drops to a cached process while
         * the app is out of sight, and the app stays alive (Float's service) while its renderer is the first thing
         * Android reclaims: the next open showed the last frame, the launch screen while the page loaded again, then
         * the app. Kept, an open is the page as it was left.
         */
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
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

    /*
     * Coming back from the app switcher without a flash.
     *
     * Android shows its own picture of the app (the switcher's preview) while the app returns, and takes it down at
     * the window's first frame. A WebView's first frame after being hidden is not the page: its drawn tiles were let
     * go when it left the screen, so that frame is the WebView's background colour, and the page follows a few
     * frames later once it has been drawn again. The preview is exactly what the page is about to show; what sits
     * between them is those empty frames.
     *
     * So the app keeps its own last frame (copied from the window as it is paused) and lays it over the WebView
     * while it is stopped. The window's first frame back is then that picture, the same as the preview it replaces,
     * and it is taken away only once the WebView says the page is ready to be drawn, and has drawn it.
     */
    private android.graphics.Bitmap lastFrame;
    private android.widget.ImageView returnCover;
    private final Runnable dropReturnCover = () -> {
        if (returnCover == null) return;
        android.view.ViewGroup parent = (android.view.ViewGroup) returnCover.getParent();
        if (parent != null) parent.removeView(returnCover);
        returnCover.setImageDrawable(null);
        returnCover = null;
    };

    @Override
    public void onResume() {
        ConduitFloatService.setAppForeground(true);
        super.onResume();
    }

    @Override
    public void onPause() {
        super.onPause();
        ConduitFloatService.setAppForeground(false);
        // A copy that fails (the surface already gone) leaves no frame, never an older one.
        lastFrame = null;
        if (android.os.Build.VERSION.SDK_INT < 26) return;
        android.view.View decor = getWindow().getDecorView();
        if (decor.getWidth() <= 0 || decor.getHeight() <= 0) return;
        try {
            android.graphics.Bitmap frame = android.graphics.Bitmap.createBitmap(decor.getWidth(), decor.getHeight(), android.graphics.Bitmap.Config.ARGB_8888);
            android.view.PixelCopy.request(getWindow(), frame, result -> {
                if (result == android.view.PixelCopy.SUCCESS) lastFrame = frame;
            }, new android.os.Handler(android.os.Looper.getMainLooper()));
        } catch (RuntimeException ignored) { /* no surface to copy: come back uncovered */ }
    }

    @Override
    public void onStop() {
        super.onStop();
        // Laid over while out of sight, so it is already there in the first frame back.
        android.view.ViewGroup decor = (android.view.ViewGroup) getWindow().getDecorView();
        if (lastFrame == null || returnCover != null || lastFrame.getWidth() != decor.getWidth() || lastFrame.getHeight() != decor.getHeight()) return;
        returnCover = new android.widget.ImageView(this);
        returnCover.setImageBitmap(lastFrame);
        returnCover.setScaleType(android.widget.ImageView.ScaleType.FIT_XY);
        returnCover.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        decor.addView(returnCover, new android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT));
    }

    @Override
    public void onStart() {
        super.onStart();
        if (returnCover == null) return;
        android.view.View cover = returnCover;
        // The window changed shape while away (rotated, split): the picture no longer fits it.
        android.view.View decor = getWindow().getDecorView();
        if (lastFrame == null || lastFrame.getWidth() != decor.getWidth() || lastFrame.getHeight() != decor.getHeight()) { dropReturnCover.run(); return; }
        getBridge().getWebView().postVisualStateCallback(1, new WebView.VisualStateCallback() {
            // Ready to be drawn is not yet drawn: two frames on, the page is what is under the picture.
            @Override public void onComplete(long requestId) { cover.postOnAnimation(() -> cover.postOnAnimation(dropReturnCover)); }
        });
        // A page that never answers is not left under a still picture.
        cover.postDelayed(dropReturnCover, 800);
    }

    @Override
    public void onDestroy() {
        dropReturnCover.run();
        lastFrame = null;
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        ConduitPushPlugin.handleIntent(this, intent);
    }
}
