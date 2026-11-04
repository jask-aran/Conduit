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

/** A native copy of the phone's measured field and pills. Only inset progress moves this overlay. */
@CapacitorPlugin(name = "ConduitComposer")
public class ConduitComposerPlugin extends Plugin {
    private FrameLayout root, controls, field, edits;
    private EditText input;
    private float scale, density, restBottom, fieldGap, fieldX, fieldWidth, rowHeight, minHeight, maxHeight, iconSize;
    private int navBottom, imeBottom, fieldHeight;
    private boolean changing, animating, closing, returning, seenIme;
    private JSONObject press;

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
                rowHeight = (float) row.optDouble("height") * scale;
                fieldX = webOrigin[0] - contentOrigin[0] + (float) box.optDouble("x") * scale;
                fieldWidth = (float) box.optDouble("width") * scale;
                fieldGap = ((float) row.optDouble("y") - (float) box.optDouble("y") - (float) box.optDouble("height")) * scale;
                minHeight = (float) type.optDouble("minHeight", 44) * scale;
                maxHeight = (float) type.optDouble("maxHeight", 192) * scale;
                iconSize = (float) type.optDouble("iconSize", 18) * scale;
                press = call.getObject("press");
                seenIme = closing = returning = animating = false;
                WindowInsetsCompat initial = ViewCompat.getRootWindowInsets(content);
                navBottom = initial == null ? 0 : initial.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
                imeBottom = initial == null ? 0 : initial.getInsets(WindowInsetsCompat.Type.ime()).bottom;
                root = new FrameLayout(getActivity());
                root.setClipChildren(false); root.setClipToPadding(false);
                content.addView(root, new FrameLayout.LayoutParams(-1, -1));
                controls = new FrameLayout(getActivity());
                controls.setClipChildren(false); controls.setClipToPadding(false);
                root.addView(controls, new FrameLayout.LayoutParams(-1, Math.round(rowHeight), Gravity.BOTTOM));
                edits = new FrameLayout(getActivity());
                edits.setClipChildren(false); edits.setClipToPadding(false);
                root.addView(edits, new FrameLayout.LayoutParams(-1, 0, Gravity.BOTTOM));
                field = new FrameLayout(getActivity());
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
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
                input.setSingleLine(false); input.setHorizontallyScrolling(false);
                Typeface geist = androidx.core.content.res.ResourcesCompat.getFont(getContext(), R.font.composer_geist);
                input.setTypeface(android.os.Build.VERSION.SDK_INT >= 28 ? Typeface.create(geist, type.optInt("weight", 400), false) : geist);
                input.setTextSize(TypedValue.COMPLEX_UNIT_PX, (float) type.optDouble("size", 16) * scale);
                input.setIncludeFontPadding(false);
                input.setMinHeight(0); input.setMinimumHeight(0);
                input.setBreakStrategy(android.text.Layout.BREAK_STRATEGY_SIMPLE);
                input.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI);
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
                        if (!changing) { emitInput(); grow(); }
                    }
                    public void afterTextChanged(Editable text) {}
                });
                setPills(controls, call.getArray("pills", new JSArray()), webOrigin[0] - contentOrigin[0], (float) row.optDouble("y") + (float) row.optDouble("height"), false);
                setPills(edits, call.getArray("editPills", new JSArray()), webOrigin[0] - contentOrigin[0], (float) box.optDouble("y"), true);
                ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
                    if (!animating) { move(insets); if (closing && !insets.isVisible(WindowInsetsCompat.Type.ime())) atRest(); }
                    return insets;
                });
                ViewCompat.setWindowInsetsAnimationCallback(root, new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                    @Override public void onPrepare(WindowInsetsAnimationCompat animation) {
                        if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) animating = true;
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
                grow();
                root.post(() -> {
                    if (root == null || closing || returning) return;
                    input.requestFocus();
                    ((InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE)).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
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
    private void place(int height) {
        if (root == null) return;
        FrameLayout.LayoutParams row = (FrameLayout.LayoutParams) controls.getLayoutParams(); row.bottomMargin = Math.round(restBottom); controls.setLayoutParams(row);
        FrameLayout.LayoutParams box = (FrameLayout.LayoutParams) field.getLayoutParams();
        box.leftMargin = Math.round(fieldX); box.bottomMargin = Math.round(restBottom + rowHeight + fieldGap); box.height = height; field.setLayoutParams(box);
        FrameLayout.LayoutParams editBox = (FrameLayout.LayoutParams) edits.getLayoutParams();
        editBox.bottomMargin = box.bottomMargin + height; edits.setLayoutParams(editBox);
        if (height != fieldHeight) {
            fieldHeight = height; JSObject event = new JSObject(); event.put("height", height / scale); notifyListeners("height", event);
        }
    }
    private void grow() {
        if (input == null) return;
        input.measure(View.MeasureSpec.makeMeasureSpec(Math.round(fieldWidth), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        place(Math.round(Math.max(minHeight, Math.min(maxHeight, input.getMeasuredHeight()))));
    }
    private void setPills(FrameLayout holder, JSONArray pills, int offsetX, float bottom, boolean edit) {
        holder.removeAllViews();
        int extent = 0;
        for (int i = 0; i < pills.length(); i++) {
            JSONObject pill = pills.optJSONObject(i); if (pill == null) continue;
            JSONObject rect = pill.optJSONObject("rect"); if (rect == null) continue;
            String name = pill.optString("name");
            int icon;
            switch (name) {
                case "attach": icon = R.drawable.composer_plus; break;
                case "camera": icon = R.drawable.composer_camera; break;
                case "keyboard": icon = R.drawable.composer_keyboard; break;
                case "mic": icon = R.drawable.composer_mic; break;
                case "send": icon = R.drawable.composer_send; break;
                case "stop": icon = R.drawable.composer_stop; break;
                case "latest": icon = R.drawable.composer_latest; break;
                case "undo": icon = R.drawable.composer_undo; break;
                case "delete": icon = R.drawable.composer_delete; break;
                case "left": icon = R.drawable.composer_left; break;
                case "right": icon = R.drawable.composer_right; break;
                case "select": icon = R.drawable.composer_select; break;
                default: continue;
            }
            ImageButton button = new ImageButton(getActivity());
            button.setImageResource(icon); button.setImageTintList(ColorStateList.valueOf(0xffe8e9eb));
            int h = Math.round((float) rect.optDouble("height") * scale), w = Math.round((float) rect.optDouble("width") * scale);
            button.setBackground(new Frost(h / 2f, edit ? 0xff3b3a3d : 0xff38393c));
            button.setPadding(Math.max(0, Math.round((w - iconSize) / 2)), Math.max(0, Math.round((h - iconSize) / 2)), Math.max(0, Math.round((w - iconSize) / 2)), Math.max(0, Math.round((h - iconSize) / 2)));
            button.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
            button.setContentDescription(pill.optString("label")); button.setEnabled(pill.optBoolean("enabled")); button.setAlpha(button.isEnabled() ? 1 : .45f);
            button.setOnClickListener(view -> {
                if (closing || returning) return;
                // Send the latest selection and text before any action can send or close the draft.
                emitInput();
                if (pill.optBoolean("press") && press != null) ConduitHapticsPlugin.play(getContext(), press.optJSONArray("steps"), press.optString("weight", "click"), view);
                if ("send".equals(name)) {
                    changing = true; input.setText(""); changing = false; grow();
                }
                JSObject event = new JSObject(); event.put("name", name); notifyListeners("action", event);
            });
            FrameLayout.LayoutParams box = new FrameLayout.LayoutParams(w, h, Gravity.LEFT | Gravity.BOTTOM);
            box.leftMargin = offsetX + Math.round((float) rect.optDouble("x") * scale); box.bottomMargin = Math.round((bottom - (float) rect.optDouble("y") - (float) rect.optDouble("height")) * scale);
            extent = Math.max(extent, box.bottomMargin + h);
            holder.addView(button, box);
        }
        if (edit) {
            FrameLayout.LayoutParams box = (FrameLayout.LayoutParams) holder.getLayoutParams();
            box.height = extent; holder.setLayoutParams(box);
        }
    }
    @PluginMethod public void update(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (input != null && !returning) {
                String text = call.getString("text");
                boolean textChanged = text != null && !text.contentEquals(input.getText());
                int start = call.getInt("selectionStart", input.getSelectionStart());
                int end = call.getInt("selectionEnd", input.getSelectionEnd());
                changing = true;
                if (textChanged) input.setText(text);
                if (textChanged || call.hasOption("selectionStart") || call.hasOption("selectionEnd")) select(start, end);
                changing = false;
                if (textChanged) grow();
                JSArray pills = call.getArray("pills"), editPills = call.getArray("editPills");
                JSObject row = call.getObject("row"), box = call.getObject("field");
                if (pills != null && row != null || editPills != null && box != null) {
                    int[] web = new int[2], host = new int[2]; getBridge().getWebView().getLocationInWindow(web); root.getLocationInWindow(host);
                    if (pills != null && row != null) setPills(controls, pills, web[0] - host[0], (float) row.optDouble("y") + (float) row.optDouble("height"), false);
                    if (editPills != null && box != null) setPills(edits, editPills, web[0] - host[0], (float) box.optDouble("y"), true);
                }
                Double height = call.getDouble("fieldHeight");
                if (height != null) place(Math.round(Math.max(minHeight, Math.min(maxHeight, height.floatValue() * scale))));
            }
            call.resolve();
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
        returning = true; root.setTranslationY(0); input.clearFocus();
        notifyListeners("ended", value());
    }
    private void remove() {
        if (root != null) {
            ViewCompat.setWindowInsetsAnimationCallback(root, null); ViewCompat.setOnApplyWindowInsetsListener(root, null);
            ((ViewGroup) root.getParent()).removeView(root);
        }
        root = controls = field = edits = null; input = null; fieldHeight = 0;
    }
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(this::remove); }

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
