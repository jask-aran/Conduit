package com.jaskaran.conduit;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

public class ConduitFloatBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
            || !ConduitFloatPlugin.preferences(context).getBoolean("enabled", false)
            || !Settings.canDrawOverlays(context) || !ConduitFloatPlugin.microphoneGranted(context)) return;
        // Android 14+ forbids a microphone FGS at boot. Restore only the idle overlay;
        // its first recording tap opens the activity to establish microphone access.
        Intent service = new Intent(context, ConduitFloatService.class).setAction(ConduitFloatService.RESTORE);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (RuntimeException error) { android.util.Log.w("ConduitFloat", "Open Conduit to restore Float"); }
    }
}
