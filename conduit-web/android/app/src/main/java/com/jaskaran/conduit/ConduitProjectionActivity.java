package com.jaskaran.conduit;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;

/** Hosts the system consent dialog; no captured content is kept in the activity. */
public final class ConduitProjectionActivity extends Activity {
    private String id;
    private boolean returned;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        id = getIntent().getStringExtra(ConduitContext.REQUEST);
        if (!ConduitContext.pending(id)) { finish(); return; }
        if (state != null) return;
        try {
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent consent = Build.VERSION.SDK_INT >= 34
                ? manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                : manager.createScreenCaptureIntent();
            startActivityForResult(consent, 1);
        } catch (RuntimeException e) {
            returned = true;
            ConduitContext.fail(id, "screenshot", "Screenshot unavailable");
            finish();
        }
    }

    @Override protected void onDestroy() {
        if (!isChangingConfigurations() && !returned && ConduitContext.pending(id)) {
            ConduitContext.fail(id, "screenshot", "Screenshot cancelled");
        }
        super.onDestroy();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != 1) return;
        returned = true;
        if (result != RESULT_OK || data == null) {
            ConduitContext.fail(id, "screenshot", "Screenshot cancelled");
        } else if (ConduitContext.pending(id)) {
            try {
                Intent service = new Intent(this, ConduitProjectionService.class)
                    .putExtra(ConduitContext.REQUEST, id).putExtra("consent", data).putExtra("resultCode", result);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
                else startService(service);
            } catch (RuntimeException e) {
                ConduitContext.fail(id, "screenshot", "Screenshot unavailable");
            }
        }
        finish();
    }
}
