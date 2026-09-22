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
    }
}
