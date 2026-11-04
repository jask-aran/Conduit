package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.graphics.Rect;
import android.view.View;
import android.view.animation.Interpolator;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;

/** The property lists and in/out timing in components/ui/styles/motion.css. IME translation is never a move. */
final class ConduitMoves {
    private final long quick, gentle;
    private final Interpolator arrive, leave, change, room;
    private final boolean reduced;
    /** The keyboard's travel under way, if any: a room given during it takes its end and its curve. */
    private long travelEnds = 0; private Interpolator travelCurve = null;
    void travel(long durationMs, Interpolator curve) {
        travelEnds = android.os.SystemClock.uptimeMillis() + durationMs; travelCurve = curve;
    }

    ConduitMoves(JSONObject spec) {
        quick = Math.max(0, spec.optLong("quick")); gentle = Math.max(0, spec.optLong("gentle"));
        arrive = curve(spec.optJSONArray("arrive")); leave = curve(spec.optJSONArray("leave")); change = curve(spec.optJSONArray("change"));
        room = curve(spec.optJSONArray("room"));
        reduced = spec.optBoolean("reducedMotion");
    }
    private static Interpolator curve(JSONArray points) {
        if (points == null || points.length() != 4) throw new IllegalArgumentException("Missing move curve");
        return new PathInterpolator((float) points.optDouble(0), (float) points.optDouble(1), (float) points.optDouble(2), (float) points.optDouble(3));
    }
    static final class Part {
        final View view;
        JSONObject state;
        final Map<String, ValueAnimator> running = new HashMap<>();
        final Map<String, Float> values = new HashMap<>(), targets = new HashMap<>();
        float x, y, width, height, opacity = 1, dim = 1, clip, clipRadius;
        Part(View view) { this.view = view; }
        void draw() {
            FrameLayout.LayoutParams box = (FrameLayout.LayoutParams) view.getLayoutParams();
            box.gravity = android.view.Gravity.TOP | android.view.Gravity.LEFT;
            box.leftMargin = Math.round(x); box.topMargin = Math.round(y);
            box.width = Math.max(0, Math.round(width)); box.height = Math.max(0, Math.round(height));
            view.setLayoutParams(box); view.setAlpha(opacity * dim);
            view.setClipBounds(clip == 0 ? null : new Rect(Math.round(width * clip), 0, Math.round(width), Math.round(height)));
            view.invalidateOutline();
        }
        void cancel() { for (ValueAnimator animation : running.values()) animation.cancel(); running.clear(); targets.clear(); }
    }
    /** Begin at the live web presentation, including an entrance already in progress. */
    void seed(Part part, JSONObject state, float x, float y, float width, float height, float opacity) {
        part.state = state;
        part.x = x; part.y = y; part.width = width; part.height = height; part.opacity = opacity;
        part.values.put("x", x); part.values.put("y", y); part.values.put("width", width); part.values.put("height", height);
        part.values.put("opacity", opacity);
    }
    private interface Setter { void set(float value); }
    private void to(Part part, String key, float target, long time, long delay, Interpolator curve, boolean initial, Setter set) {
        Float previous = part.targets.get(key);
        if (!initial && previous != null && Math.abs(previous - target) < .01f && !reduced) return;
        ValueAnimator old = part.running.remove(key);
        if (old != null) old.cancel();
        part.targets.put(key, target);
        float from = part.values.containsKey(key) ? part.values.get(key) : target;
        if (initial || reduced || (time == 0 && delay == 0) || from == target) {
            part.values.put(key, target); set.set(target); return;
        }
        ValueAnimator animation = ValueAnimator.ofFloat(from, target);
        animation.setDuration(time); animation.setStartDelay(delay); animation.setInterpolator(curve);
        animation.addUpdateListener(value -> { float next = (float) value.getAnimatedValue(); part.values.put(key, next); set.set(next); part.draw(); });
        part.running.put(key, animation); animation.start();
    }
    /** Rects are the row's solved flex layout: circles keep size while tucking; grow hands remaining room to the mic.
     * Each geometric channel retains its current value on reversal and ignores unchanged destinations. */
    void update(Part part, JSONObject state, float x, float y, float width, float height, long roomDelay, boolean fieldOut) {
        boolean initial = part.state == null, out = state.optBoolean("out"), folded = state.optBoolean("folded");
        boolean field = "field".equals(state.optString("kind"));
        String move = state.optString("move");
        long layoutTime = gentle, layoutDelay = roomDelay, fadeTime = out ? quick : gentle, fadeDelay = 0;
        Interpolator fadeCurve = out ? leave : arrive;
        switch (move) {
            case "tuck": break;
            case "collapse": layoutDelay = 0; break;
            case "wipe": fadeTime = out ? quick : 0; fadeCurve = leave; break;
            case "give": fadeTime = 0; break;
            case "fade":
                // The field follows its collapse holder, after its quick fade on the way out.
                if (field) layoutDelay = 0;
                break;
            default: throw new IllegalArgumentException("Unknown composer move: " + move);
        }
        boolean fieldRoom = field || "collapse".equals(move);
        Interpolator layoutCurve = fieldRoom ? room : arrive;
        long left = travelEnds - android.os.SystemClock.uptimeMillis();
        if (fieldRoom && left > 16 && !reduced) { layoutTime = left; layoutCurve = travelCurve != null ? travelCurve : room; }

        to(part, "x", x, layoutTime, layoutDelay, layoutCurve, initial, v -> part.x = v);
        boolean edit = state.optBoolean("edit");
        // The edit pills fade where they stand: their holder holds them at its foot, so their room goes from above them.
        if (!(edit && out)) to(part, "y", y, edit ? (left > 16 && !reduced ? left : layoutTime) : layoutTime, layoutDelay, edit ? (left > 16 && travelCurve != null && !reduced ? travelCurve : room) : layoutCurve, initial, v -> part.y = v);
        to(part, "width", width, layoutTime, layoutDelay, layoutCurve, initial, v -> part.width = v);
        to(part, "height", field && out ? 0 : height, layoutTime, layoutDelay, layoutCurve, initial, v -> part.height = v);
        to(part, "opacity", out ? 0 : 1, fadeTime, fadeDelay, fadeCurve, initial, v -> part.opacity = v);
        to(part, "dim", state.optBoolean("under") ? .38f : 1, quick, 0, change, initial, v -> part.dim = v);
        to(part, "clip", "wipe".equals(move) && out ? 1 : 0, gentle, 0, arrive, initial, v -> part.clip = v);
        boolean wipe = "wipe".equals(move);
        part.view.setClipToOutline(wipe);
        if (wipe) part.view.setOutlineProvider(new android.view.ViewOutlineProvider() {
            @Override public void getOutline(View view, android.graphics.Outline outline) {
                outline.setRoundRect(Math.round(part.width * part.clip), 0, Math.round(part.width), Math.round(part.height), part.clipRadius);
            }
        });
        part.view.setVisibility(state.optBoolean("hidden") ? View.INVISIBLE : View.VISIBLE);
        part.view.setClickable(!out && !state.optBoolean("disabled") && "pill".equals(state.optString("kind")));
        part.view.setEnabled(!state.optBoolean("disabled"));
        part.state = state; part.draw();
    }
    long quick() { return reduced ? 0 : quick; }
}
