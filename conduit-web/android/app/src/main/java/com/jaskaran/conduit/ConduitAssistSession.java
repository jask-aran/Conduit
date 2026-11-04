package com.jaskaran.conduit;

import android.app.assist.AssistContent;
import android.app.assist.AssistStructure;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;
import android.view.View;
import android.view.WindowManager;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** One screen per invocation. No assistant panel and no screen data in logs. */
public final class ConduitAssistSession extends VoiceInteractionSession {
    private final Context context;
    private final long at = System.currentTimeMillis();
    private Bitmap screenshot;
    private ConduitContext.Screen screen;
    private boolean assistArrived, screenshotArrived, expired, delivered, destroyed;
    private final Runnable timeout = () -> { expired = true; complete(); };

    public ConduitAssistSession(Context context) {
        super(context);
        this.context = context;
        setTheme(android.R.style.Theme_Translucent_NoTitleBar);
        if (Build.VERSION.SDK_INT >= 26) setUiEnabled(false);
    }

    @Override public View onCreateContentView() {
        // API 24–25 have no setUiEnabled: leave a transparent, non-interactive window.
        getWindow().getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
        getWindow().getWindow().setDimAmount(0);
        return new View(context);
    }

    @Override public void onShow(Bundle args, int flags) {
        super.onShow(args, flags);
        ConduitContext.MAIN.postDelayed(timeout, 1500);
    }

    @Override public void onHandleAssist(AssistState state) {
        if (state.isFocused()) acceptStructure(state.getAssistStructure());
    }

    @SuppressWarnings("deprecation")
    @Override public void onHandleAssist(Bundle data, AssistStructure structure, AssistContent content) {
        acceptStructure(structure);
    }

    private void acceptStructure(AssistStructure structure) {
        if (delivered || destroyed) return;
        assistArrived = true;
        screen = readScreen(structure);
        complete();
    }

    @Override public void onHandleScreenshot(Bitmap bitmap) {
        if (delivered || destroyed) {
            if (bitmap != null) bitmap.recycle();
            return;
        }
        if (screenshot != null && screenshot != bitmap) screenshot.recycle();
        screenshot = bitmap;
        screenshotArrived = true;
        complete();
    }

    private void complete() {
        if (delivered || destroyed || (!(assistArrived && screenshotArrived) && !expired)) return;
        delivered = true;
        ConduitContext.MAIN.removeCallbacks(timeout);
        Bitmap bitmap = screenshot;
        screenshot = null;
        ConduitContext.fromAssistant(context, bitmap, screen, at, result -> {
            if (destroyed) {
                if (result.image != null) result.image.delete();
                return;
            }
            try {
                FloatAssist.deliver(context, result);
                if (!FloatAssist.floatOn(context)) {
                    try {
                        context.startActivity(new Intent(context, MainActivity.class)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (RuntimeException unavailable) { /* The capture remains held by FloatAssist. */ }
                }
            } finally { finish(); }
        });
    }

    @Override public void onDestroy() {
        destroyed = true;
        ConduitContext.MAIN.removeCallbacks(timeout);
        if (screenshot != null) { screenshot.recycle(); screenshot = null; }
        super.onDestroy();
    }

    private ConduitContext.Screen readScreen(AssistStructure structure) {
        StringBuilder text = new StringBuilder();
        String pkg = null, label = null;
        try {
            ComponentName activity = structure == null ? null : structure.getActivityComponent();
            if (activity == null || activity.getPackageName().startsWith("com.jaskaran.conduit")) return null;
            pkg = activity.getPackageName();
            try {
                label = context.getPackageManager().getApplicationLabel(
                    context.getPackageManager().getApplicationInfo(pkg, 0)).toString();
            } catch (PackageManager.NameNotFoundException ignored) {}
            List<AssistStructure.WindowNode> windows = new ArrayList<>();
            for (int i = 0; i < structure.getWindowNodeCount() && i < 4000; i++) windows.add(structure.getWindowNodeAt(i));
            windows.sort(Comparator.comparingInt(AssistStructure.WindowNode::getTop)
                .thenComparingInt(AssistStructure.WindowNode::getLeft));
            int[] budget = { 4000 };
            for (AssistStructure.WindowNode window : windows) walk(window.getRootViewNode(), text, budget, 0);
        } catch (RuntimeException unavailable) { /* Retain text already read from a disappearing window. */ }
        return new ConduitContext.Screen(text.toString(), label, pkg);
    }

    private static void walk(AssistStructure.ViewNode node, StringBuilder out, int[] budget, int depth) {
        if (node == null || out.length() >= 8000 || depth > 64 || budget[0]-- <= 0
            || node.getVisibility() != View.VISIBLE) return;
        String value = clean(node.getText());
        String description = clean(node.getContentDescription());
        if (!description.isEmpty() && !description.equals(value)) value = value.isEmpty() ? description : value + " · " + description;
        if (!value.isEmpty()) {
            if (out.length() > 0) out.append('\n');
            out.append(value, 0, Math.min(value.length(), 8000 - out.length()));
        }
        List<AssistStructure.ViewNode> children = new ArrayList<>();
        for (int i = 0; i < node.getChildCount() && i < budget[0]; i++) {
            AssistStructure.ViewNode child = node.getChildAt(i);
            if (child != null) children.add(child);
        }
        children.sort(Comparator.comparingInt(AssistStructure.ViewNode::getTop)
            .thenComparingInt(AssistStructure.ViewNode::getLeft));
        for (AssistStructure.ViewNode child : children) {
            if (out.length() >= 8000 || budget[0] <= 0) break;
            walk(child, out, budget, depth + 1);
        }
    }

    private static String clean(CharSequence text) {
        return text == null ? "" : text.toString().replaceAll("\\s+", " ").trim();
    }
}
