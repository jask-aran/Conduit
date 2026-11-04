package com.jaskaran.conduit;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;

/** Uses the system photo picker and caches its images for WebView attachments. */
@CapacitorPlugin(name = "ConduitPhotos")
public class ConduitPhotosPlugin extends Plugin {
    private boolean picking;

    @PluginMethod
    public void pick(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (picking) { call.reject("Photo picker is already open"); return; }
            try {
                int max = Math.max(1, Math.min(50, call.getInt("max", 10)));
                PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
                    .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE).build();
                Intent intent = max == 1
                    ? new ActivityResultContracts.PickVisualMedia().createIntent(getContext(), request)
                    : new ActivityResultContracts.PickMultipleVisualMedia(max).createIntent(getContext(), request);
                // The contracts use documents when no system or backported photo picker exists.
                if (Intent.ACTION_OPEN_DOCUMENT.equals(intent.getAction())) {
                    call.reject("Photo picker is unavailable");
                    return;
                }
                picking = true;
                startActivityForResult(call, intent, "photosPicked");
            } catch (Exception error) {
                picking = false;
                call.reject("Could not open photo picker");
            }
        });
    }

    @ActivityCallback
    private void photosPicked(PluginCall call, ActivityResult result) {
        if (call == null) { picking = false; return; }
        getBridge().execute(() -> {
            try {
                List<Uri> uris = new ActivityResultContracts.PickMultipleVisualMedia()
                    .parseResult(result.getResultCode(), result.getData());
                JSArray files = new JSArray();
                if (!uris.isEmpty()) {
                    File directory = new File(getContext().getCacheDir(), "picked");
                    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
                    File[] older = directory.listFiles();
                    if (older == null) throw new IOException();
                    for (File file : older) if (!file.delete()) throw new IOException();
                    int max = Math.max(1, Math.min(50, call.getInt("max", 10)));
                    for (int i = 0; i < Math.min(max, uris.size()); i++) {
                        files.put(copyPhoto(uris.get(i), directory, i + 1));
                    }
                }
                call.resolve(new JSObject().put("files", files));
            } catch (Exception error) {
                call.reject("Could not read selected photos");
            } finally {
                getActivity().runOnUiThread(() -> picking = false);
            }
        });
    }

    private JSObject copyPhoto(Uri uri, File directory, int index) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        String mimeType = resolver.getType(uri);
        if (mimeType == null) mimeType = "application/octet-stream";
        String name = null;
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        }
        if (name != null) name = name.replaceAll("[/\\\\\\p{Cntrl}]", "_");
        if (name == null || name.trim().isEmpty() || name.equals(".") || name.equals("..")) {
            String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
            name = "photo-" + index + "." + (extension == null ? "bin" : extension);
        }
        File target = new File(directory, name);
        if (target.exists()) target = new File(directory, index + "-" + name);
        // Never overwrite another selected image, including names with numeric prefixes.
        while (target.exists()) target = new File(directory, "_" + target.getName());
        try (InputStream input = resolver.openInputStream(uri);
             FileOutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IOException();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
        return new JSObject().put("path", target.getAbsolutePath()).put("name", name)
            .put("mimeType", mimeType).put("size", target.length());
    }
}
