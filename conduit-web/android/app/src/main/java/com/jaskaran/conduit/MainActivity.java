package com.jaskaran.conduit;

import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge is built, which is the only point at
        // which a plugin living in the app rather than in a package can be
        // added to it.
        registerPlugin(ConduitDiscoveryPlugin.class);
        registerPlugin(ConduitKeyboardPlugin.class);
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
        /*
         * A pin handed in at launch, for a development build only.
         *
         * The real one arrives from a paired server record, once an
         * attestation has been verified against the identity key the client
         * already holds. Until that is plumbed this is how a build under test
         * is told which certificate to expect, and it is gated on the app
         * being debuggable because a pin any launcher can set is a pin
         * anything on the device can set.
         */
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            String pin = getIntent() == null ? null : getIntent().getStringExtra("conduitPin");
            if (pin != null && !pin.isEmpty()) {
                ConduitWebViewClient.pin(new java.util.HashSet<>(java.util.Arrays.asList(pin.split(","))));
            }
        }
    }
}
