package com.jaskaran.conduit;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before the bridge is built, which is the only point at
        // which a plugin living in the app rather than in a package can be
        // added to it.
        registerPlugin(ConduitDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
