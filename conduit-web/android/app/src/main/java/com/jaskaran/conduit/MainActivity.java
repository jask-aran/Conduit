package com.jaskaran.conduit;

import android.os.Bundle;
import android.content.Intent;

import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    // Set when the page has loaded, scripts and all: its first commit is too early, a blank frame before the mark.
    private volatile boolean pageVisible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Held until the page has drawn, or the system drops it at the WebView's first, white frame. Two seconds is a
        // ceiling for a page that never commits.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        long shownAt = android.os.SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(() -> !pageVisible && android.os.SystemClock.uptimeMillis() - shownAt < 2000);
        // The WebView does not draw while the system's launch window covers the app, so the splash is kept over the
        // window until the WebView says its content is on screen.
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
        // Before super.onCreate: the bridge reads which interface to load as it is built, and app plugins can only be
        // registered before then.
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
        // Edge to edge the page runs under both bars, and only the navigation bar's contrast is enforced by default.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(true);
            getWindow().setNavigationBarContrastEnforced(true);
        }
        // Out of legacy soft-input handling, which resizes in one step and runs no inset animation for
        // ConduitKeyboardPlugin to follow.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // After the bridge is built: the bridge installs its own client as it builds.
        getBridge().setWebViewClient(new ConduitWebViewClient(getBridge()));
        getBridge().getWebView().setBackgroundColor(getColor(R.color.conduit_frame));
        // By default a hidden renderer drops to a cached process and is the first thing Android reclaims, while Float's
        // service keeps the app alive, so the next open reloads the page.
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) { pageVisible = true; }
        });
        // Debuggable builds only: a launch extra any launcher can set is one anything on the device can set.
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

    // A WebView's first frames after being hidden are its background colour (its tiles were let go), so the last
    // frame is copied on pause and laid over it until the page has drawn again.
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
        android.view.View decor = getWindow().getDecorView();
        if (lastFrame == null || lastFrame.getWidth() != decor.getWidth() || lastFrame.getHeight() != decor.getHeight()) { dropReturnCover.run(); return; }
        getBridge().getWebView().postVisualStateCallback(1, new WebView.VisualStateCallback() {
            // Ready to be drawn is not yet drawn: two frames on, the page is what is under the picture.
            @Override public void onComplete(long requestId) { cover.postOnAnimation(() -> cover.postOnAnimation(dropReturnCover)); }
        });
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
