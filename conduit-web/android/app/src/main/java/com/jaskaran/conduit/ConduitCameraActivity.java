package com.jaskaran.conduit;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;

/** Hosts runtime permission and the system camera. The FileProvider is shared with the app. */
public final class ConduitCameraActivity extends Activity {
    private String id;
    private File source;
    private Uri uri;
    private boolean returned;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        id = getIntent().getStringExtra(ConduitContext.REQUEST);
        if (!ConduitContext.pending(id)) { finish(); return; }
        try {
            if (state != null) {
                String path = state.getString("source");
                if (path != null) {
                    source = new File(path);
                    uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", source);
                }
                return;
            }
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[] { Manifest.permission.CAMERA }, 1);
            } else launchCamera();
        } catch (RuntimeException e) { fail("Camera unavailable"); }
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request != 1) return;
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) launchCamera();
        else fail("Camera permission is needed");
    }

    private void launchCamera() {
        try {
            source = ConduitContext.newFile(this);
            uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", source);
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            camera.setClipData(ClipData.newRawUri("Photo", uri));
            startActivityForResult(camera, 2);
        } catch (IOException | RuntimeException e) { fail("Camera unavailable"); }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (source != null) state.putString("source", source.getAbsolutePath());
        super.onSaveInstanceState(state);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != 2) return;
        returned = true;
        revokePhotoAccess();
        if (result == RESULT_OK && source != null) {
            ConduitContext.savePhoto(getApplicationContext(), id, source, System.currentTimeMillis());
            finish();
        } else fail("Photo cancelled");
    }

    @Override protected void onDestroy() {
        if (!isChangingConfigurations() && !returned && ConduitContext.pending(id)) {
            revokePhotoAccess();
            if (source != null) source.delete();
            ConduitContext.fail(id, "photo", "Photo cancelled");
        }
        super.onDestroy();
    }

    private void revokePhotoAccess() {
        if (uri != null) revokeUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }

    private void fail(String error) {
        returned = true;
        revokePhotoAccess();
        if (source != null) source.delete();
        ConduitContext.fail(id, "photo", error);
        finish();
    }
}
