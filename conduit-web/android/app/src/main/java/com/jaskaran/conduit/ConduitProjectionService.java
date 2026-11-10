package com.jaskaran.conduit;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;

import java.nio.ByteBuffer;

/** One consent, one display, one frame. Never restarted by Android. */
public final class ConduitProjectionService extends Service {
    private String id;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private boolean done;
    private final Runnable timeout = () -> fail("Screenshot timed out");
    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override public void onStop() { fail("Screenshot cancelled"); }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String next = intent == null ? null : intent.getStringExtra(ConduitContext.REQUEST);
        if (id != null) {
            if (next != null && !next.equals(id)) ConduitContext.fail(next, "screenshot", "A screenshot is already in progress");
            return START_NOT_STICKY;
        }
        // Started with startForegroundService: stopping before startForeground crashes the app (Android 9+).
        if (!ConduitContext.pending(next)) { try { foreground(); } catch (RuntimeException refused) {} stopSelf(); return START_NOT_STICKY; }
        id = next;
        try {
            foreground();
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            Intent consent = intent.getParcelableExtra("consent");
            projection = manager.getMediaProjection(intent.getIntExtra("resultCode", 0), consent);
            if (projection == null) throw new IllegalStateException("Projection unavailable");
            projection.registerCallback(projectionCallback, ConduitContext.MAIN);
            ConduitContext.MAIN.postDelayed(timeout, 10000);
            // Let the consent activity finish and leave the display before requesting a frame.
            ConduitContext.afterFrames(() -> {
                if (done) return;
                try { startCapture(); }
                catch (RuntimeException | OutOfMemoryError e) { fail("Screenshot unavailable"); }
            });
        } catch (RuntimeException e) { fail("Screenshot unavailable"); }
        return START_NOT_STICKY;
    }

    private void foreground() {
        Notification notification = notification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(72, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        else startForeground(72, notification);
    }

    private Notification notification() {
        String channelId = "conduit_context_capture";
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(channelId, getString(R.string.context_capture_channel), NotificationManager.IMPORTANCE_MIN);
            channel.setSound(null, null);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        return new NotificationCompat.Builder(this, channelId).setSmallIcon(R.drawable.ic_stat_conduit)
            .setContentTitle(getString(R.string.context_capture_notification)).setOngoing(true).setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN).setShowWhen(false).build();
    }

    private void startCapture() {
        WindowManager windows = (WindowManager) getSystemService(WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        windows.getDefaultDisplay().getRealMetrics(metrics);
        int width = metrics.widthPixels, height = metrics.heightPixels;
        if (Build.VERSION.SDK_INT >= 30) {
            Rect bounds = windows.getMaximumWindowMetrics().getBounds();
            width = bounds.width();
            height = bounds.height();
        }
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(source -> {
            if (done) return;
            Bitmap bitmap = null;
            try (Image image = source.acquireNextImage()) {
                if (image == null) return;
                long at = System.currentTimeMillis();
                Image.Plane plane = image.getPlanes()[0];
                if (plane.getPixelStride() != 4) throw new IllegalStateException("Unsupported image format");
                int rowBytes = image.getWidth() * 4;
                ByteBuffer pixels = ByteBuffer.allocateDirect(rowBytes * image.getHeight());
                ByteBuffer buffer = plane.getBuffer();
                int offset = buffer.position();
                // The last row need not include row-stride padding.
                for (int row = 0; row < image.getHeight(); row++) {
                    ByteBuffer slice = buffer.duplicate();
                    slice.position(offset + row * plane.getRowStride());
                    slice.limit(slice.position() + rowBytes);
                    pixels.put(slice);
                }
                pixels.flip();
                bitmap = Bitmap.createBitmap(image.getWidth(), image.getHeight(), Bitmap.Config.ARGB_8888);
                bitmap.copyPixelsFromBuffer(pixels);
                ConduitContext.save(getApplicationContext(), id, "screenshot", bitmap, at);
                bitmap = null;
                done = true;
            } catch (RuntimeException | OutOfMemoryError e) {
                fail("Screenshot unavailable");
            } finally {
                if (bitmap != null) bitmap.recycle();
            }
            if (done) {
                release();
                stopSelf();
            }
        }, ConduitContext.MAIN);
        display = projection.createVirtualDisplay("Conduit context", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, ConduitContext.MAIN);
    }

    private void fail(String error) {
        if (done) return;
        done = true;
        if (id != null) ConduitContext.fail(id, "screenshot", error);
        release();
        stopSelf();
    }

    private void release() {
        ConduitContext.MAIN.removeCallbacks(timeout);
        if (display != null) { display.release(); display = null; }
        if (reader != null) { reader.close(); reader = null; }
        if (projection != null) {
            MediaProjection previous = projection;
            projection = null;
            previous.unregisterCallback(projectionCallback);
            previous.stop();
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    @Override public void onDestroy() {
        if (!done && id != null) {
            done = true;
            ConduitContext.fail(id, "screenshot", "Screenshot cancelled");
        }
        release();
        super.onDestroy();
    }
}
