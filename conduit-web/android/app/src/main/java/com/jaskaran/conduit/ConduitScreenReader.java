package com.jaskaran.conduit;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** No event-driven reads: only ConduitContext requests inspect the screen. */
public final class ConduitScreenReader extends AccessibilityService {
    static ConduitScreenReader instance;

    @Override protected void onServiceConnected() { instance = this; }
    @Override public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) {}
    @Override public void onInterrupt() {}

    ConduitContext.Screen readScreen() {
        StringBuilder text = new StringBuilder();
        String pkg = null;
        String label = null;
        boolean read = false;
        List<AccessibilityNodeInfo> roots = new ArrayList<>();
        List<AccessibilityWindowInfo> windows = new ArrayList<>();
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root != null) {
                roots.add(root);
                pkg = root.getPackageName() == null ? null : root.getPackageName().toString();
                if (ownPackage(pkg)) pkg = null;
                if (pkg != null) {
                    read = true;
                    // Interactive windows are needed for the active app's dialogs and other windows.
                    windows = getWindows();
                    for (AccessibilityWindowInfo window : windows) {
                        if (window.getId() == root.getWindowId() || window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                        AccessibilityNodeInfo other = window.getRoot();
                        if (other == null) continue;
                        if (pkg.contentEquals(other.getPackageName() == null ? "" : other.getPackageName())) roots.add(other);
                        else other.recycle();
                    }
                    roots.sort(READING_ORDER);
                    int[] budget = { 4000 };
                    for (AccessibilityNodeInfo item : roots) walk(item, text, budget, 0);
                    try {
                        label = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString();
                    } catch (android.content.pm.PackageManager.NameNotFoundException ignored) {}
                }
            }
        } catch (RuntimeException ignored) {
            // A window can disappear during an explicitly requested read. Keep the partial text.
        } finally {
            for (AccessibilityNodeInfo root : roots) root.recycle();
            for (AccessibilityWindowInfo window : windows) window.recycle();
        }
        return new ConduitContext.Screen(read ? text.toString() : null, label, pkg);
    }

    private static boolean ownPackage(String pkg) { return pkg != null && pkg.startsWith("com.jaskaran.conduit"); }

    private static final Comparator<AccessibilityNodeInfo> READING_ORDER = (a, b) -> {
        Rect ra = new Rect(), rb = new Rect();
        a.getBoundsInScreen(ra);
        b.getBoundsInScreen(rb);
        int row = Integer.compare(ra.top, rb.top);
        return row != 0 ? row : Integer.compare(ra.left, rb.left);
    };

    private static void walk(AccessibilityNodeInfo node, StringBuilder out, int[] budget, int depth) {
        if (out.length() >= 8000 || depth > 64 || budget[0]-- <= 0) return;
        if (ownPackage(node.getPackageName() == null ? null : node.getPackageName().toString())) return;
        if (node.isVisibleToUser()) {
            String value = node.getText() == null ? "" : node.getText().toString().replaceAll("\\s+", " ").trim();
            String description = node.getContentDescription() == null ? "" : node.getContentDescription().toString().replaceAll("\\s+", " ").trim();
            if (!description.isEmpty() && !description.equals(value)) value = value.isEmpty() ? description : value + " · " + description;
            if (!value.isEmpty()) {
                if (out.length() > 0) out.append('\n');
                out.append(value, 0, Math.min(value.length(), 8000 - out.length()));
            }
        }
        List<AccessibilityNodeInfo> children = new ArrayList<>();
        try {
            for (int i = 0; i < node.getChildCount() && i < 4000; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) children.add(child);
            }
            children.sort(READING_ORDER);
            for (AccessibilityNodeInfo child : children) {
                if (out.length() >= 8000 || budget[0] <= 0) break;
                walk(child, out, budget, depth + 1);
            }
        } finally { for (AccessibilityNodeInfo child : children) child.recycle(); }
    }

    void capture(String id) {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override public void onSuccess(ScreenshotResult result) {
                    long at = System.currentTimeMillis();
                    Bitmap bitmap = null;
                    try (HardwareBuffer buffer = result.getHardwareBuffer()) {
                        Bitmap hardware = Bitmap.wrapHardwareBuffer(buffer, result.getColorSpace());
                        if (hardware == null) throw new IllegalStateException("Screenshot unavailable");
                        try { bitmap = hardware.copy(Bitmap.Config.ARGB_8888, false); }
                        finally { hardware.recycle(); }
                        if (bitmap == null) throw new IllegalStateException("Screenshot unavailable");
                    } catch (RuntimeException | OutOfMemoryError e) {
                        if (bitmap != null) bitmap.recycle();
                        ConduitContext.fail(id, "screenshot", "Screenshot unavailable");
                        return;
                    }
                    ConduitContext.save(getApplicationContext(), id, "screenshot", bitmap, at);
                }
                @Override public void onFailure(int errorCode) {
                    ConduitContext.fail(id, "screenshot", "Cannot capture this screen");
                }
            });
        } catch (RuntimeException e) {
            ConduitContext.fail(id, "screenshot", "Screenshot unavailable");
        }
    }
}
