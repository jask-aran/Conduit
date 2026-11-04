package com.jaskaran.conduit;

import android.Manifest;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The composer's camera card (the web's Viewfinder, components/ui/viewfinder.tsx, drawn natively): CameraX's own
 * preview and capture in a card over the page's foot, picture in picture, so the picture is the camera pipeline's,
 * clear and at full rate, not the WebView's. Close at its start, the shutter in its middle, Flip at its end, Full
 * camera in its top corner. open() resolves { file } (a JPEG in the cache, read by the page as a photo), { full: true }
 * (hand over to the platform's camera app), { failed: true } (no camera here), or {} (closed). Its corners are
 * concentric with the pills inset in it; it rises in on the gentle arrive curve and leaves the way it came, quick.
 */
@CapacitorPlugin(name = "ConduitCamera", permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) })
public class ConduitCameraPlugin extends Plugin {
    private static final float INSET = 16, PILL = 44, SHUTTER = 44 + 12;
    private FrameLayout card;
    private PluginCall pending;
    private ProcessCameraProvider provider;
    private ImageCapture capture;
    private boolean front, leaving;
    private View flash;
    private OnBackPressedCallback back;
    private org.json.JSONArray pressSteps;
    private String pressWeight = "click";

    private int dp(float value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }

    @PluginMethod
    public void open(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) { requestPermissionForAlias("camera", call, "permitted"); return; }
        show(call);
    }

    @PermissionCallback
    private void permitted(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) show(call);
        else call.resolve(new JSObject().put("failed", true));
    }

    private void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (card != null) { call.reject("The camera is already open"); return; }
            pending = call;
            leaving = false;
            front = false;
            JSObject press = call.getObject("press");
            pressSteps = press == null ? null : press.optJSONArray("steps");
            pressWeight = press == null ? "click" : press.optString("weight", "click");
            build();
            bind();
        });
    }

    private GradientDrawable circle(int fill, int stroke) {
        GradientDrawable shape = new GradientDrawable();
        shape.setShape(GradientDrawable.OVAL);
        shape.setColor(fill);
        if (stroke != 0) shape.setStroke(dp(1), stroke);
        return shape;
    }

    /** A frost pill as the page draws one: white 17% over the picture, its one light stroke, a light glyph. */
    private ImageButton pill(int icon, String label, View.OnClickListener click) {
        ImageButton button = new ImageButton(getContext());
        button.setImageResource(icon);
        button.setImageTintList(ColorStateList.valueOf(0xffe8e9eb));
        button.setScaleType(ImageView.ScaleType.CENTER);
        button.setBackground(circle(0x2bffffff, 0x4dffffff));
        button.setContentDescription(label);
        button.setOnClickListener(click);
        return button;
    }

    private void build() {
        AppCompatActivity activity = getActivity();
        ViewGroup root = activity.findViewById(android.R.id.content);
        card = new FrameLayout(activity);
        card.setBackgroundColor(0xff141518);
        card.setClickable(true);
        card.setContentDescription("Camera");
        float radius = dp(PILL / 2 + INSET);
        card.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View view, Outline outline) { outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius); }
        });
        card.setClipToOutline(true);
        card.setElevation(dp(8));

        PreviewView preview = new PreviewView(activity);
        // A TextureView, so the card's rounded clip holds (a SurfaceView draws past it).
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        preview.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        preview.setId(View.generateViewId());
        card.addView(preview, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        card.setTag(preview);

        flash = new View(activity);
        flash.setBackgroundColor(Color.WHITE);
        flash.setAlpha(0);
        card.addView(flash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        FrameLayout.LayoutParams corner = new FrameLayout.LayoutParams(dp(PILL), dp(PILL), Gravity.TOP | Gravity.END);
        corner.setMargins(0, dp(INSET), dp(INSET), 0);
        card.addView(pill(R.drawable.camera_full, "Full camera", view -> leave(new JSObject().put("full", true))), corner);

        FrameLayout.LayoutParams start = new FrameLayout.LayoutParams(dp(PILL), dp(PILL), Gravity.BOTTOM | Gravity.START);
        start.setMargins(dp(INSET), 0, 0, dp(INSET + (SHUTTER - PILL) / 2));
        card.addView(pill(R.drawable.camera_close, "Close", view -> leave(new JSObject())), start);

        FrameLayout.LayoutParams end = new FrameLayout.LayoutParams(dp(PILL), dp(PILL), Gravity.BOTTOM | Gravity.END);
        end.setMargins(0, 0, dp(INSET), dp(INSET + (SHUTTER - PILL) / 2));
        card.addView(pill(R.drawable.camera_flip, "Flip camera", view -> { front = !front; bind(); }), end);

        // The shutter: a light disc in a frost ring, the one solid control.
        View shutter = new View(activity);
        GradientDrawable ring = circle(0x00000000, 0);
        ring.setStroke(dp(2), 0x2bffffff);
        GradientDrawable disc = circle(0xffe8e9eb, 0);
        LayerDrawable face = new LayerDrawable(new android.graphics.drawable.Drawable[] { ring, disc });
        face.setLayerInset(1, dp(4), dp(4), dp(4), dp(4));
        shutter.setBackground(face);
        shutter.setContentDescription("Take the photo");
        shutter.setClickable(true);
        shutter.setOnClickListener(view -> take());
        shutter.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == android.view.MotionEvent.ACTION_DOWN) view.animate().scaleX(.92f).scaleY(.92f).setDuration(120).start();
            else if (event.getActionMasked() == android.view.MotionEvent.ACTION_UP || event.getActionMasked() == android.view.MotionEvent.ACTION_CANCEL)
                view.animate().scaleX(1).scaleY(1).setDuration(120).start();
            return false;
        });
        FrameLayout.LayoutParams middle = new FrameLayout.LayoutParams(dp(SHUTTER), dp(SHUTTER), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        middle.setMargins(0, 0, 0, dp(INSET));
        card.addView(shutter, middle);

        // Placed over the page's foot: inset from the sides, above the navigation bar, 3:4 within the room there is.
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
        Insets bars = insets == null ? Insets.NONE : insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        int width = root.getWidth() - 2 * dp(INSET);
        int room = root.getHeight() - bars.top - bars.bottom - dp(PILL) - 3 * dp(INSET);
        int height = Math.min(Math.round(width * 4f / 3f), room);
        FrameLayout.LayoutParams place = new FrameLayout.LayoutParams(width, height, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        place.setMargins(0, 0, 0, bars.bottom + dp(INSET));
        root.addView(card, place);

        card.setAlpha(0);
        card.setTranslationY(dp(24));
        card.animate().alpha(1).translationY(0).setDuration(250).setInterpolator(new PathInterpolator(.2f, .8f, .2f, 1f)).start();

        back = new OnBackPressedCallback(true) { @Override public void handleOnBackPressed() { leave(new JSObject()); } };
        activity.getOnBackPressedDispatcher().addCallback(activity, back);
    }

    private void bind() {
        if (card == null) return;
        PreviewView preview = (PreviewView) card.getTag();
        com.google.common.util.concurrent.ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(getContext());
        future.addListener(() -> {
            if (card == null || leaving) return;
            try {
                provider = future.get();
                provider.unbindAll();
                Preview stage = new Preview.Builder().build();
                stage.setSurfaceProvider(preview.getSurfaceProvider());
                capture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setTargetRotation(preview.getDisplay() != null ? preview.getDisplay().getRotation() : android.view.Surface.ROTATION_0).build();
                CameraSelector selector = front ? CameraSelector.DEFAULT_FRONT_CAMERA : CameraSelector.DEFAULT_BACK_CAMERA;
                if (!provider.hasCamera(selector)) { front = !front; selector = front ? CameraSelector.DEFAULT_FRONT_CAMERA : CameraSelector.DEFAULT_BACK_CAMERA; }
                provider.bindToLifecycle(getActivity(), selector, stage, capture);
            } catch (Exception error) {
                leave(new JSObject().put("failed", true));
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private void take() {
        if (capture == null || leaving) return;
        ConduitHapticsPlugin.play(getContext(), pressSteps, pressWeight, card);
        flash.setAlpha(.7f);
        flash.animate().alpha(0).setDuration(250).start();
        File directory = new File(getContext().getCacheDir(), "camera");
        File[] older = directory.listFiles();
        if (older != null) for (File file : older) file.delete();
        directory.mkdirs();
        String name = "photo-" + new SimpleDateFormat("yyyy-MM-dd-HH-mm-ss", Locale.ROOT).format(new Date()) + ".jpg";
        File target = new File(directory, name);
        ImageCapture.Metadata metadata = new ImageCapture.Metadata();
        // The front camera is taken as others see it, as the platform's camera does by default.
        metadata.setReversedHorizontal(false);
        ImageCapture.OutputFileOptions options = new ImageCapture.OutputFileOptions.Builder(target).setMetadata(metadata).build();
        capture.takePicture(options, ContextCompat.getMainExecutor(getContext()), new ImageCapture.OnImageSavedCallback() {
            @Override public void onImageSaved(ImageCapture.OutputFileResults results) {
                leave(new JSObject().put("file", new JSObject().put("path", target.getAbsolutePath()).put("name", name).put("mimeType", "image/jpeg").put("size", target.length())));
            }
            @Override public void onError(ImageCaptureException error) { leave(new JSObject().put("failed", true)); }
        });
    }

    /** Leaves the way it came (quick, on the leaving curve), releases the camera and answers the page. */
    private void leave(JSObject answer) {
        if (card == null || leaving) return;
        leaving = true;
        if (provider != null) provider.unbindAll();
        if (back != null) { back.remove(); back = null; }
        FrameLayout gone = card;
        gone.animate().alpha(0).translationY(dp(24)).setDuration(150).setInterpolator(new PathInterpolator(.4f, 0f, 1f, 1f))
            .withEndAction(() -> { ViewGroup parent = (ViewGroup) gone.getParent(); if (parent != null) parent.removeView(gone); }).start();
        card = null;
        capture = null;
        PluginCall call = pending;
        pending = null;
        if (call != null) call.resolve(answer);
    }

    @Override protected void handleOnPause() {
        super.handleOnPause();
        // Leaving the app closes the camera: a card left open would hold it while unseen.
        if (card != null) getActivity().runOnUiThread(() -> leave(new JSObject()));
    }
}
