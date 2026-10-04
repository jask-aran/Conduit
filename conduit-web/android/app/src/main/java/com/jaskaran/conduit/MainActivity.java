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
        registerPlugin(ConduitTlsPlugin.class);
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
