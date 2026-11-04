package com.jaskaran.conduit;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Choreographer;
import android.view.accessibility.AccessibilityManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** One-shot context capture. Callers must hide their overlays before screenshot(). */
public final class ConduitContext {
    private ConduitContext() {}
    static final String REQUEST = "contextRequest";
    static final Handler MAIN = new Handler(Looper.getMainLooper());
    static final ExecutorService IMAGES = Executors.newSingleThreadExecutor();
    private static final Map<String, Consumer<Result>> CALLBACKS = new HashMap<>();
    private static final Map<String, Screen> SCREENS = new HashMap<>();

    public static final class Result {
        public final String kind;
        public final File image;
        public final String screenText;
        public final String appLabel;
        public final String appPackage;
        public final long at;
        public final String error;

        private Result(String kind, File image, Screen screen, long at, String error) {
            if ((image == null) == (error == null)) throw new IllegalArgumentException("Image or error required");
            this.kind = kind;
            this.image = image;
            this.screenText = screen == null ? null : screen.text;
            this.appLabel = screen == null ? null : screen.label;
            this.appPackage = screen == null ? null : screen.pkg;
            this.at = at;
            this.error = error;
        }
    }

    static final class Screen {
        final String text, label, pkg;
        Screen(String text, String label, String pkg) {
            this.text = text;
            this.label = label;
            this.pkg = pkg;
        }
    }

    public static boolean screenReaderOn(Context context) {
        AccessibilityManager manager = (AccessibilityManager) context.getSystemService(Context.ACCESSIBILITY_SERVICE);
        ComponentName expected = new ComponentName(context, ConduitScreenReader.class);
        for (AccessibilityServiceInfo info : manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
            if (expected.equals(ComponentName.unflattenFromString(info.getId()))) return true;
        }
        return false;
    }

    /**
     * Android's Accessibility list. (Its page for one service, ACCESSIBILITY_DETAILS_SETTINGS, resolves on Samsung but
     * refuses apps with a SecurityException.)
     */
    public static void openScreenReaderSettings(Context context) {
        try { context.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (RuntimeException unavailable) { /* No settings app to open. */ }
    }

    public static void screenshot(Context context, Consumer<Result> callback) {
        Context app = context.getApplicationContext();
        String id = register(callback);
        afterFrames(() -> {
            ConduitScreenReader reader = ConduitScreenReader.instance;
            if (screenReaderOn(app)) {
                if (reader == null) {
                    fail(id, "screenshot", "Screen reader is not ready");
                    return;
                }
                SCREENS.put(id, reader.readScreen());
                if (Build.VERSION.SDK_INT >= 30) {
                    reader.capture(id);
                    MAIN.postDelayed(() -> fail(id, "screenshot", "Screenshot timed out"), 15000);
                    return;
                }
            }
            launch(app, ConduitProjectionActivity.class, id, "screenshot");
        });
    }

    public static void photo(Context context, Consumer<Result> callback) {
        launch(context.getApplicationContext(), ConduitCameraActivity.class, register(callback), "photo");
    }

    private static String register(Consumer<Result> callback) {
        String id = UUID.randomUUID().toString();
        CALLBACKS.put(id, java.util.Objects.requireNonNull(callback));
        return id;
    }

    private static void launch(Context app, Class<?> activity, String id, String kind) {
        try {
            app.startActivity(new Intent(app, activity).putExtra(REQUEST, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION));
        } catch (RuntimeException e) {
            fail(id, kind, kind.equals("photo") ? "Camera unavailable" : "Screenshot unavailable");
        }
    }

    static boolean pending(String id) { return id != null && CALLBACKS.containsKey(id); }

    static void afterFrames(Runnable action) {
        Choreographer.getInstance().postFrameCallback(first ->
            Choreographer.getInstance().postFrameCallback(second -> action.run()));
    }

    static void fail(String id, String kind, String error) {
        finish(id, new Result(kind, null, null, System.currentTimeMillis(), error));
    }

    private static void finish(String id, Result result) {
        MAIN.post(() -> {
            Consumer<Result> callback = CALLBACKS.remove(id);
            SCREENS.remove(id);
            if (callback != null) callback.accept(result);
            else if (result.image != null) result.image.delete();
        });
    }

    static File newFile(Context context) throws IOException {
        File dir = new File(context.getCacheDir(), "context");
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("Cache unavailable");
        return File.createTempFile("capture-", ".jpg", dir);
    }

    // Takes ownership of bitmap. JPEG scaling and encoding run off the main thread.
    static void save(Context context, String id, String kind, Bitmap bitmap, long at) {
        Screen screen = SCREENS.get(id);
        IMAGES.execute(() -> encode(context, id, kind, bitmap, screen, at));
    }

    /** Main thread only. Takes ownership of bitmap; returns on the main thread, including text on failure. */
    static void fromAssistant(Context context, Bitmap bitmap, Screen screen, long at, Consumer<Result> callback) {
        if (bitmap == null) {
            callback.accept(new Result("screenshot", null, screen, at,
                context.getString(R.string.assistant_screenshot_unavailable)));
            return;
        }
        String id = register(result -> callback.accept(result.error == null ? result
            : new Result("screenshot", null, screen, at, result.error)));
        SCREENS.put(id, screen);
        save(context.getApplicationContext(), id, "screenshot", bitmap, at);
    }

    static void savePhoto(Context context, String id, File source, long at) {
        IMAGES.execute(() -> {
            Bitmap bitmap = null;
            try {
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(source.getAbsolutePath(), options);
                options.inSampleSize = 1;
                while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 4096) options.inSampleSize *= 2;
                options.inJustDecodeBounds = false;
                bitmap = BitmapFactory.decodeFile(source.getAbsolutePath(), options);
                if (bitmap == null) throw new IOException("Invalid photo");
                int orientation = new ExifInterface(source.getAbsolutePath()).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                Matrix matrix = new Matrix();
                switch (orientation) {
                    case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.setScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_180: matrix.setRotate(180); break;
                    case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.setScale(1, -1); break;
                    case ExifInterface.ORIENTATION_TRANSPOSE: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_90: matrix.setRotate(90); break;
                    case ExifInterface.ORIENTATION_TRANSVERSE: matrix.setRotate(-90); matrix.postScale(-1, 1); break;
                    case ExifInterface.ORIENTATION_ROTATE_270: matrix.setRotate(-90); break;
                    default: break;
                }
                Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                if (oriented != bitmap) bitmap.recycle();
                bitmap = null;
                encode(context, id, "photo", oriented, null, at);
            } catch (IOException | RuntimeException | OutOfMemoryError e) {
                fail(id, "photo", "Could not read photo");
            } finally {
                if (bitmap != null) bitmap.recycle();
                source.delete();
            }
        });
    }

    private static void encode(Context context, String id, String kind, Bitmap bitmap, Screen screen, long at) {
        File output = null;
        try {
            int edge = Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (edge > 2048) {
                Bitmap scaled = Bitmap.createScaledBitmap(bitmap,
                    Math.max(1, Math.round(bitmap.getWidth() * 2048f / edge)),
                    Math.max(1, Math.round(bitmap.getHeight() * 2048f / edge)), true);
                if (scaled != bitmap) bitmap.recycle();
                bitmap = scaled;
            }
            output = newFile(context);
            try (FileOutputStream stream = new FileOutputStream(output)) {
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream)) throw new IOException("JPEG failed");
            }
            finish(id, new Result(kind, output, screen, at, null));
        } catch (IOException | RuntimeException | OutOfMemoryError e) {
            if (output != null) output.delete();
            fail(id, kind, "Could not save " + kind);
        } finally {
            bitmap.recycle();
        }
    }

    /** Call after capture has returned, when the gathered context is sent or cancelled. */
    public static void clear(Context context) {
        File[] files = new File(context.getCacheDir(), "context").listFiles();
        if (files != null) for (File file : files) if (file.isFile()) file.delete();
    }
}
