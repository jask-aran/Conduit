package com.jaskaran.conduit;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;

import androidx.core.graphics.ColorUtils;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** The library PhoneComposer's described parts. Only inset progress moves the overlay itself. */
@CapacitorPlugin(name = "ConduitComposer")
public class ConduitComposerPlugin extends Plugin {
    private FrameLayout root, field;
    private EditText input;
    private float scale, density, restBottom, fieldWidth, minHeight, iconSize, offsetX;
    private int navBottom, imeBottom;
    private boolean changing, animating, closing, returning, seenIme;
    private JSONObject haptics, states, blurStates, describedRow;
    private JSONArray describedParts;
    private ConduitMoves moves;
    private final Map<String, ConduitMoves.Part> parts = new LinkedHashMap<>();
    private boolean webFocusable, webTouchFocusable, closingSent;

    @PluginMethod public void begin(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (root != null) { call.reject("Composer already active"); return; }
            JSObject viewport = call.getObject("viewport"), box = call.getObject("field"), row = call.getObject("row"), type = call.getObject("typography");
            if (viewport == null || box == null || row == null || type == null || viewport.optDouble("width") <= 0 || viewport.optDouble("height") <= 0) {
                call.reject("Missing composer geometry"); return;
            }
            try {
                FrameLayout content = getActivity().findViewById(android.R.id.content);
                View web = getBridge().getWebView();
                density = getContext().getResources().getDisplayMetrics().density;
                // CSS px -> dp = WebView physical width / density / CSS viewport width. Android layouts take px.
                float cssToDp = web.getWidth() / density / (float) viewport.optDouble("width");
                scale = cssToDp * density;
                if (scale <= 0) { call.reject("WebView has no size"); return; }
                int[] webOrigin = new int[2], contentOrigin = new int[2];
                web.getLocationInWindow(webOrigin); content.getLocationInWindow(contentOrigin);
                float viewportBottom = webOrigin[1] - contentOrigin[1] + (float) viewport.optDouble("height") * scale;
                restBottom = content.getHeight() - viewportBottom + ((float) viewport.optDouble("height") - (float) row.optDouble("y") - (float) row.optDouble("height")) * scale;
                fieldWidth = (float) box.optDouble("width") * scale;
                offsetX = webOrigin[0] - contentOrigin[0];
                minHeight = (float) type.optDouble("minHeight", 44) * scale;
                iconSize = (float) type.optDouble("iconSize", 18) * scale;
                haptics = call.getObject("haptics");
                states = call.getObject("states"); blurStates = call.getObject("blurStates");
                if (states == null || blurStates == null) { call.reject("Missing composer close states"); return; }
                JSObject spec = call.getObject("motion");
                if (spec == null) { call.reject("Missing composer moves"); return; }
                moves = new ConduitMoves(spec);
                webFocusable = web.isFocusable(); webTouchFocusable = web.isFocusableInTouchMode();
                web.setFocusableInTouchMode(false); web.setFocusable(false);
                closingSent = false;
                seenIme = closing = returning = animating = false;
                WindowInsetsCompat initial = ViewCompat.getRootWindowInsets(content);
                navBottom = initial == null ? 0 : initial.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
                imeBottom = initial == null ? 0 : initial.getInsets(WindowInsetsCompat.Type.ime()).bottom;
                root = new FrameLayout(getActivity()) {
                    @Override public boolean dispatchTouchEvent(MotionEvent event) {
                        if (event.getActionMasked() == MotionEvent.ACTION_DOWN && !hitsPart(event.getX(), event.getY())) hideKeyboard();
                        // An unhandled touch falls through to the WebView, including the complete scroll gesture.
                        return super.dispatchTouchEvent(event);
                    }
                };
                root.setClipChildren(false); root.setClipToPadding(false);
                content.addView(root, new FrameLayout.LayoutParams(-1, -1));
                field = new FrameLayout(getActivity()) {
                    @Override public boolean dispatchTouchEvent(MotionEvent event) {
                        ConduitMoves.Part part = parts.get("field");
                        if (closing || returning || part != null && part.state != null && part.state.optBoolean("out")) return false;
                        return super.dispatchTouchEvent(event);
                    }
                };
                field.setBackground(new Frost((float) type.optDouble("radius", 18) * scale, 0xff3b3a3d));
                root.addView(field, new FrameLayout.LayoutParams(Math.round(fieldWidth), Math.round(minHeight), Gravity.BOTTOM | Gravity.LEFT));
                input = new EditText(getActivity()) {
                    @Override protected void onSelectionChanged(int start, int end) {
                        super.onSelectionChanged(start, end);
                        if (ConduitComposerPlugin.this.input == this && !changing && !returning) emitInput();
                    }
                };
                input.setBackground(null);
                input.setTextColor(0xffe8e9eb); input.setHintTextColor(0xff888a8e);
                input.setHighlightColor(0x33e8e9eb);
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    GradientDrawable cursor = new GradientDrawable(); cursor.setColor(0xffe8e9eb); cursor.setSize(Math.max(1, Math.round(density)), 1);
                    input.setTextCursorDrawable(cursor);
                    for (Drawable handle : new Drawable[] { input.getTextSelectHandle(), input.getTextSelectHandleLeft(), input.getTextSelectHandleRight() })
                        if (handle != null) handle.setTint(0xffe8e9eb);
                }
                // The web textarea's own EditorInfo (read from dumpsys input_method), so the keyboard shows the same layout either
                // way and a hand back to the WebView never swaps it.
                input.setInputType(0x22c0a1);
                input.setSingleLine(false); input.setHorizontallyScrolling(false);
                Typeface geist = androidx.core.content.res.ResourcesCompat.getFont(getContext(), R.font.composer_geist);
                input.setTypeface(android.os.Build.VERSION.SDK_INT >= 28 ? Typeface.create(geist, type.optInt("weight", 400), false) : geist);
                input.setTextSize(TypedValue.COMPLEX_UNIT_PX, (float) type.optDouble("size", 16) * scale);
                input.setIncludeFontPadding(false);
                input.setMinHeight(0); input.setMinimumHeight(0);
                input.setBreakStrategy(android.text.Layout.BREAK_STRATEGY_SIMPLE);
                input.setImeOptions(0x12000001);
                input.setLineSpacing((float) type.optDouble("lineHeight", 22.4) * scale - input.getPaint().getFontSpacing(), 1);
                int px = Math.round((float) type.optDouble("paddingX", 14) * scale);
                int py = Math.round((float) type.optDouble("paddingY", 9.8) * scale);
                input.setPadding(px, py, px, py);
                input.setGravity(Gravity.TOP | Gravity.LEFT);
                input.setOverScrollMode(View.OVER_SCROLL_NEVER);
                input.setHint(call.getString("placeholder", ""));
                field.addView(input, new FrameLayout.LayoutParams(-1, -1));
                changing = true; input.setText(call.getString("text", ""));
                select(call.getInt("selectionStart", input.length()), call.getInt("selectionEnd", input.length())); changing = false;
                input.addTextChangedListener(new TextWatcher() {
                    public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                    public void onTextChanged(CharSequence s, int start, int before, int count) {
                        if (!changing) emitInput();
                    }
                    public void afterTextChanged(Editable text) {}
                });
                setParts(call.getArray("parts", new JSArray()), row);
                ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
                    if (!animating) { if (seenIme && !insets.isVisible(WindowInsetsCompat.Type.ime())) announceClosing(); move(insets); if (closing && !insets.isVisible(WindowInsetsCompat.Type.ime())) atRest(); }
                    return insets;
                });
                ViewCompat.setWindowInsetsAnimationCallback(root, new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    @Override public void onPrepare(WindowInsetsAnimationCompat animation) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) animating = true;
                    }
                    @Override public WindowInsetsAnimationCompat.BoundsCompat onStart(WindowInsetsAnimationCompat animation, WindowInsetsAnimationCompat.BoundsCompat bounds) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0 && root != null) {
                            // Insets at onStart contain the destination. Do not change the per-frame tracking below.
                            WindowInsetsCompat target = ViewCompat.getRootWindowInsets(root);
                            if (target != null && !target.isVisible(WindowInsetsCompat.Type.ime())) announceClosing();
                        }
                        return bounds;
                    }
                    @Override public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> running) {
                        move(insets); return insets;
                    }
                    @Override public void onEnd(WindowInsetsAnimationCompat animation) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) == 0 || root == null) return;
                        animating = false;
                        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
                        if (insets != null) {
                            move(insets);
                            if (!insets.isVisible(WindowInsetsCompat.Type.ime())) atRest();
                        }
                    }
                });
                root.post(() -> {
                    if (root == null || closing || returning) return;
                    input.requestFocus();
                    /*
                     * Through the window's insets controller, not showSoftInput: the WebView still holds the input
                     * connection on this frame, and showSoftInput on a view that is not yet the served one is ignored
                     * ("is not served"), leaving the keyboard to come up a second later on a retry. The controller
                     * waits for the focused view to be served and then shows it.
                     */
                    androidx.core.view.WindowCompat.getInsetsController(getActivity().getWindow(), input).show(WindowInsetsCompat.Type.ime());
                    root.requestApplyInsets();
                });
                call.resolve();
            } catch (Exception error) { remove(); call.reject("Cannot open native composer", error); }
        });
    }

    private void select(int start, int end) {
        start = Math.max(0, Math.min(input.length(), start));
        input.setSelection(start, Math.max(start, Math.min(input.length(), end)));
    }
    private JSObject value() {
        JSObject result = new JSObject(); result.put("text", input.getText().toString());
        result.put("selectionStart", Math.max(0, input.getSelectionStart())); result.put("selectionEnd", Math.max(0, input.getSelectionEnd()));
        return result;
    }
    private void emitInput() { if (input != null) notifyListeners("input", value()); }
    private void move(WindowInsetsCompat insets) {
        if (root == null) return;
        imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        if (imeBottom > navBottom) seenIme = true;
        // The resting margin includes the navigation bar. The IME covers that bar as it rises.
        root.setTranslationY(-Math.max(0, imeBottom - navBottom));
        if (seenIme && !animating && !insets.isVisible(WindowInsetsCompat.Type.ime())) atRest();
    }
    private void announceClosing() {
        if (root == null || closingSent) return;
        closing = closingSent = true;
        // Start the described close target in this UI frame, before the WebView receives closing.
        if (describedParts != null && describedRow != null) setParts(describedParts, describedRow);
        notifyListeners("closing", value());
    }
    private void hideKeyboard() {
        if (input == null || returning) return;
        announceClosing();
        ((InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
    }
    private boolean hitsPart(float x, float y) {
        for (ConduitMoves.Part part : parts.values()) {
            if (part.state == null || part.state.optBoolean("out") || part.state.optBoolean("hidden") || !part.view.isEnabled() || part.opacity == 0) continue;
            if (!"pill".equals(part.state.optString("kind")) && !"field".equals(part.state.optString("kind"))) continue;
            if (x >= part.x && x < part.x + part.width && y >= part.y && y < part.y + part.height) return true;
        }
        return false;
    }
    private int icon(String name) {
        switch (name) {
            case "attach": return R.drawable.composer_plus;
            case "camera": return R.drawable.composer_camera;
            case "keyboard": return R.drawable.composer_keyboard;
            case "mic": return R.drawable.composer_mic;
            case "send": return R.drawable.composer_send;
            case "stop": return R.drawable.composer_stop;
            case "latest": return R.drawable.composer_latest;
            case "undo": return R.drawable.composer_undo;
            case "delete": return R.drawable.composer_delete;
            case "left": return R.drawable.composer_left;
            case "right": return R.drawable.composer_right;
            case "select": return R.drawable.composer_select;
            default: return 0;
        }
    }
    private void tap(ConduitMoves.Part part) {
        if (closing || returning || part.state == null || part.state.optBoolean("out") || part.state.optBoolean("disabled")) return;
        // The input event precedes the action, so send and edit use the latest selection without logging the draft.
        emitInput();
        String name = part.state.optString("action");
        JSONObject effect = haptics == null ? null : haptics.optJSONObject(part.state.optString("haptic"));
        if (effect != null) ConduitHapticsPlugin.play(getContext(), effect.optJSONArray("steps"), effect.optString("weight", "tick"), part.view);
        JSObject event = new JSObject(); event.put("name", name); notifyListeners("action", event);
    }
    /** The web supplies the blur rule and the library state table. Only draft presence is read locally. */
    private JSONArray closedParts(JSONArray description, JSONObject row) {
        // Java's trim omits some whitespace that JavaScript's draft.trim() removes.
        boolean empty = input.getText().toString().replaceAll("^[\\x09-\\x0D\\x20\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+$", "").isEmpty();
        JSONArray shown = states.optJSONArray(blurStates.optString(empty ? "empty" : "text"));
        if (shown == null) throw new IllegalArgumentException("Missing composer blur target");
        Set<String> show = new HashSet<>();
        for (int i = 0; i < shown.length(); i++) show.add(shown.optString(i));
        double shift = 0;
        if (!show.contains("field")) for (int i = 0; i < description.length(); i++) {
            JSONObject part = description.optJSONObject(i);
            if (part != null && "holder".equals(part.optString("kind")) && !part.optBoolean("out")) {
                JSONObject rect = part.optJSONObject("rect");
                if (rect != null) shift = row.optDouble("y") - rect.optDouble("y");
            }
        }
        JSONArray result = new JSONArray();
        try {
            for (int i = 0; i < description.length(); i++) {
                JSONObject part = new JSONObject(description.getJSONObject(i).toString());
                String kind = part.optString("kind");
                String group = part.optBoolean("edit") ? "edit" : "field".equals(kind) || "holder".equals(kind) ? "field" : "pills";
                // Voice and send retain their independent state, as in the web MoveScope.
                if (!part.optBoolean("voice") && !"room".equals(kind)) part.put("out", part.optBoolean("folded") || !show.contains(group));
                JSONObject rect = part.getJSONObject("rect");
                if ("field".equals(group) || "edit".equals(group)) rect.put("y", rect.optDouble("y") + shift);
                if ("holder".equals(kind) && !show.contains("field")) rect.put("height", 0);
                result.put(part);
            }
        } catch (org.json.JSONException error) { throw new IllegalArgumentException("Invalid composer close parts", error); }
        return result;
    }
    private void setParts(JSONArray description, JSONObject row) {
        describedParts = description; describedRow = row;
        if (closingSent) description = closedParts(description, row);
        float bottom = (float) (row.optDouble("y") + row.optDouble("height"));
        Set<String> present = new HashSet<>();
        long roomDelay = 0;
        for (int i = 0; i < description.length(); i++) {
            JSONObject state = description.optJSONObject(i); if (state == null) continue;
            ConduitMoves.Part old = parts.get(state.optString("id"));
            if (old != null && old.state != null && !old.state.optBoolean("folded") && state.optBoolean("folded") && "fold".equals(state.optString("move"))) roomDelay = moves.quick();
        }
        for (int i = 0; i < description.length(); i++) {
            JSONObject state = description.optJSONObject(i); if (state == null) continue;
            String id = state.optString("id"), kind = state.optString("kind");
            JSONObject rect = state.optJSONObject("rect"); if (rect == null) continue;
            present.add(id);
            ConduitMoves.Part part = parts.get(id);
            boolean added = part == null;
            if (part == null) {
                View view;
                if ("field".equals(kind)) view = field;
                else if ("pill".equals(kind)) {
                    ImageButton button = new ImageButton(getActivity()) {
                        @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
                            super.onSizeChanged(w, h, oldw, oldh);
                            int px = Math.max(0, Math.round((w - iconSize) / 2)), py = Math.max(0, Math.round((h - iconSize) / 2));
                            setPadding(px, py, px, py);
                        }
                    };
                    button.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
                    button.setImageTintList(ColorStateList.valueOf(0xffe8e9eb));
                    button.setBackground(new Frost((float) rect.optDouble("height") * scale / 2, state.optBoolean("edit") ? 0xff3b3a3d : 0xff38393c));
                    view = button;
                } else view = new View(getActivity());
                if (view != field) root.addView(view, new FrameLayout.LayoutParams(0, 0));
                part = new ConduitMoves.Part(view); parts.put(id, part);
                ConduitMoves.Part target = part;
                if (view instanceof ImageButton) view.setOnClickListener(v -> tap(target));
            }
            if (part.view instanceof ImageButton) {
                ImageButton button = (ImageButton) part.view;
                if (part.state == null || !part.state.optString("icon").equals(state.optString("icon")) || part.state.optLong("spin") != state.optLong("spin")) {
                    if ("spinner".equals(state.optString("icon"))) button.setImageDrawable(new Spinner(state.optLong("spin")));
                    else button.setImageResource(icon(state.optString("icon")));
                }
                Drawable glyph = button.getDrawable();
                if (glyph != null) glyph.setAlpha(Math.round(255 * (float) state.optDouble("contentOpacity", 1)));
                button.setContentDescription(state.optString("label"));
            }
            if ("field".equals(kind)) { input.setEnabled(!state.optBoolean("disabled")); input.setContentDescription(state.optString("label")); input.setHint(state.optString("placeholder")); }
            part.clipRadius = (float) state.optDouble("clipRadius") * scale;
            float x = offsetX + (float) rect.optDouble("x") * scale;
            float height = (float) rect.optDouble("height") * scale;
            float y = root.getLayoutParams().height == -1 ? ((View) root.getParent()).getHeight() : root.getHeight();
            y -= restBottom + (bottom - (float) rect.optDouble("y")) * scale;
            JSONObject presentation = state.optJSONObject("presentation");
            JSONObject current = presentation == null ? null : presentation.optJSONObject("rect");
            if (added && current != null) {
                float startY = ((View) root.getParent()).getHeight() - restBottom - (bottom - (float) current.optDouble("y")) * scale;
                moves.seed(part, state, offsetX + (float) current.optDouble("x") * scale, startY,
                    (float) current.optDouble("width") * scale, (float) current.optDouble("height") * scale, (float) presentation.optDouble("opacity", 1));
            }
            moves.update(part, state, x, y, (float) rect.optDouble("width") * scale, height, roomDelay);
            part.view.setZ(state.optBoolean("edit") ? 6 : "field".equals(kind) ? 2 : state.optBoolean("folded") ? 3 : state.optBoolean("voice") && state.optBoolean("stretch") ? 5 : 4);
        }
        for (String id : new HashSet<>(parts.keySet())) if (!present.contains(id)) {
            ConduitMoves.Part part = parts.remove(id); part.cancel(); root.removeView(part.view);
        }
    }
    @PluginMethod public void update(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (input != null && !returning) {
                    String text = call.getString("text");
                    boolean textChanged = text != null && !text.contentEquals(input.getText());
                    int start = call.getInt("selectionStart", input.getSelectionStart());
                    int end = call.getInt("selectionEnd", input.getSelectionEnd());
                    changing = true;
                    if (textChanged) input.setText(text);
                    if (textChanged || call.hasOption("selectionStart") || call.hasOption("selectionEnd")) select(start, end);
                    changing = false;
                    JSObject nextBlurStates = call.getObject("blurStates");
                    if (nextBlurStates != null) blurStates = nextBlurStates;
                    JSObject spec = call.getObject("motion");
                    if (spec != null) moves = new ConduitMoves(spec);
                    JSArray description = call.getArray("parts"); JSObject row = call.getObject("row");
                    if (description != null && row != null) setParts(description, row);
                }
                call.resolve();
            } catch (Exception error) { call.reject("Cannot update native composer", error); }
        });
    }
    @PluginMethod public void end(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (root != null) {
                if (returning) {
                    FrameLayout ending = root;
                    // Wait for the WebView's restored row to be drawable before removing its native cover.
                    getBridge().getWebView().postVisualStateCallback(0, new android.webkit.WebView.VisualStateCallback() {
                        @Override public void onComplete(long requestId) {
                            if (root == ending) remove();
                            call.resolve();
                        }
                    });
                    return;
                } else {
                    closing = true;
                    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
                    if (!animating && insets != null && !insets.isVisible(WindowInsetsCompat.Type.ime())) atRest();
                    else ((InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
                }
            }
            call.resolve();
        });
    }
    private void atRest() {
        if (root == null || returning) return;
        announceClosing();
        returning = true; root.setTranslationY(0); input.clearFocus();
        notifyListeners("ended", value());
    }
    private void remove() {
        if (root != null) {
            ViewCompat.setWindowInsetsAnimationCallback(root, null); ViewCompat.setOnApplyWindowInsetsListener(root, null);
            ((ViewGroup) root.getParent()).removeView(root);
        }
        for (ConduitMoves.Part part : parts.values()) part.cancel();
        parts.clear();
        if (root != null) {
            View web = getBridge().getWebView();
            web.setFocusable(webFocusable); web.setFocusableInTouchMode(webTouchFocusable);
        }
        root = field = null; input = null; describedParts = null; describedRow = states = blurStates = null;
    }
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(this::remove); }

    /** The library's waiting ring. It is an effect on --duration-spin, separate from the named moves. */
    private class Spinner extends Drawable implements Runnable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final long duration, began = android.os.SystemClock.uptimeMillis();
        private int alpha = 255;
        Spinner(long duration) { this.duration = Math.max(1, duration); }
        @Override public void draw(Canvas canvas) {
            RectF box = new RectF(getBounds()); box.inset(scale / 2, scale / 2);
            paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(scale);
            paint.setColor(0xffe8e9eb); paint.setAlpha(Math.round(alpha * .08f)); canvas.drawOval(box, paint);
            paint.setAlpha(alpha);
            float turn = (android.os.SystemClock.uptimeMillis() - began) % duration * 360f / duration;
            canvas.drawArc(box, turn - 135, 90, false, paint);
            if (getCallback() instanceof View) ((View) getCallback()).postOnAnimation(this);
        }
        @Override public void run() { invalidateSelf(); }
        @Override public void setAlpha(int value) { alpha = value; invalidateSelf(); }
        @Override public void setColorFilter(android.graphics.ColorFilter filter) { paint.setColorFilter(filter); }
        @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
    }

    /** One .ui-frost layer: Frost plain gives the row no extra material (frost.tsx).
     * Flat reference fills use C = alpha * white + (1 - alpha) * pageGround, alpha = 43/255
     * (--frost-fill, foundations.css). The effective backdrops inferred from the supplied phone samples
     * are #131216 for the field/edit pills and #101115 for the row: #3b3a3d and #38393c.
     * Border = white at 77/255 over that fill; inset highlights = white at 50% / 10%.
     * frost.css paints the fill under the border; its inset shadows start INSIDE that border.
     * There is no dense core and no vertical sheen gradient on these controls.
     */
    private class Frost extends Drawable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final float radius;
        private final int fill;
        Frost(float radius, int fill) { this.radius = radius; this.fill = fill; }
        @Override public void draw(Canvas canvas) {
            RectF box = new RectF(getBounds());
            // scale is the real physical-pixels/CSS-pixel ratio, including WebView zoom.
            float line = scale;
            paint.setStyle(Paint.Style.FILL); paint.setColor(fill);
            canvas.drawRoundRect(box, radius, radius, paint);
            box.inset(line / 2, line / 2);
            paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(line);
            paint.setColor(ColorUtils.compositeColors(0x4dffffff, fill));
            canvas.drawRoundRect(box, Math.max(0, radius - line / 2), Math.max(0, radius - line / 2), paint);
            box.inset(line / 2, line / 2);
            Path inside = new Path();
            inside.addRoundRect(box, Math.max(0, radius - line), Math.max(0, radius - line), Path.Direction.CW);
            // CSS inset shadows: subtract the same rounded box shifted by one CSS px.
            // This follows the curved rim too, with no blur or vertical sheen gradient.
            Path shifted = new Path(inside), highlight = new Path(inside);
            shifted.offset(0, line); highlight.op(shifted, Path.Op.DIFFERENCE);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(ColorUtils.compositeColors(0x80ffffff, fill)); canvas.drawPath(highlight, paint);
            shifted.set(inside); shifted.offset(0, -line); highlight.set(inside); highlight.op(shifted, Path.Op.DIFFERENCE);
            paint.setColor(ColorUtils.compositeColors(0x1affffff, fill)); canvas.drawPath(highlight, paint);
        }
        @Override public void setAlpha(int alpha) {}
        @Override public void setColorFilter(android.graphics.ColorFilter filter) {}
        @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
    }
}
