package com.jaskaran.conduit;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.Spannable;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.AbsoluteSizeSpan;
import android.text.style.BackgroundColorSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.LeadingMarginSpan;
import android.text.style.StyleSpan;
import android.text.style.TypefaceSpan;
import android.text.style.UnderlineSpan;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Basic, non-interactive Markdown. Unsupported syntax remains text. */
public final class FloatMarkdown {
    private static final Pattern HEADING = Pattern.compile("^(#{1,3}) +(.+)$");
    private static final Pattern LIST = Pattern.compile("^\\s*([-*]|[0-9]+\\.) +(.+)$");
    private FloatMarkdown() {}

    public static Spannable render(Context context, String markdown) {
        SpannableStringBuilder out = new SpannableStringBuilder();
        String[] lines = (markdown == null ? "" : markdown).replace("\r\n", "\n").split("\n", -1);
        float density = context.getResources().getDisplayMetrics().density;
        float scaled = context.getResources().getDisplayMetrics().scaledDensity;
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String fence = line.startsWith("```") ? "```" : line.startsWith("~~~") ? "~~~" : null;
            if (fence != null) {
                int end = i + 1;
                while (end < lines.length && !lines[end].trim().equals(fence)) end++;
                // An unmatched fence is plain text.
                if (end < lines.length) {
                    int start = out.length();
                    for (int code = i + 1; code < end; code++) {
                        out.append(lines[code]);
                        if (code < end - 1) out.append('\n');
                    }
                    span(out, new TypefaceSpan("monospace"), start);
                    span(out, new BackgroundColorSpan(0x14ffffff), start);
                    i = end;
                    if (i < lines.length - 1) out.append('\n');
                    continue;
                }
                // Preserve the entire unclosed block without parsing its contents as inline Markdown.
                for (int rest = i; rest < lines.length; rest++) {
                    if (rest > i) out.append('\n');
                    out.append(lines[rest]);
                }
                break;
            }
            int start = out.length();
            Matcher heading = HEADING.matcher(line);
            Matcher list = LIST.matcher(line);
            if (heading.matches()) {
                inline(out, heading.group(2), 0);
                span(out, new StyleSpan(Typeface.BOLD), start);
                span(out, new AbsoluteSizeSpan(Math.round((heading.group(1).length() == 3 ? 15 : 16) * scaled)), start);
            } else if (list.matches()) {
                String marker = list.group(1);
                out.append(marker.equals("-") || marker.equals("*") ? "• " : marker + " ");
                inline(out, list.group(2), 0);
                Paint paint = new Paint();
                paint.setTextSize(15 * scaled);
                String prefix = out.subSequence(start, start + (marker.equals("-") || marker.equals("*") ? 2 : marker.length() + 1)).toString();
                span(out, new LeadingMarginSpan.Standard(0, (int) Math.ceil(paint.measureText(prefix))), start);
            } else if (line.startsWith("> ") || line.equals(">")) {
                inline(out, line.length() > 1 ? line.substring(2) : "", 0);
                span(out, new ForegroundColorSpan(0x99e8e9eb), start);
                span(out, new QuoteBar(Math.max(1, Math.round(2 * density)), Math.round(10 * density)), start);
            } else inline(out, line, 0);
            if (i < lines.length - 1) out.append('\n');
        }
        return out;
    }

    private static void span(SpannableStringBuilder out, Object style, int start) {
        if (start < out.length()) out.setSpan(style, start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    private static void inline(SpannableStringBuilder out, String text, int depth) {
        if (depth > 12) { out.append(text); return; }
        for (int i = 0; i < text.length();) {
            char c = text.charAt(i);
            if (c == '[' && (i == 0 || text.charAt(i - 1) != '!')) {
                int middle = text.indexOf("](", i + 1);
                int end = middle < 0 ? -1 : text.indexOf(')', middle + 2);
                if (end >= 0) {
                    int start = out.length();
                    inline(out, text.substring(i + 1, middle), depth + 1);
                    span(out, new UnderlineSpan(), start);
                    i = end + 1;
                    continue;
                }
            }
            String mark = c == '`' ? "`" : text.startsWith("***", i) ? "***"
                : text.startsWith("**", i) ? "**" : c == '*' ? "*" : null;
            if (mark != null) {
                int end = closing(text, i + mark.length(), mark);
                if (end > i + mark.length()) {
                    int start = out.length();
                    String inside = text.substring(i + mark.length(), end);
                    if (c == '`') {
                        out.append(inside);
                        span(out, new TypefaceSpan("monospace"), start);
                        span(out, new BackgroundColorSpan(0x1affffff), start);
                    } else {
                        inline(out, inside, depth + 1);
                        span(out, new StyleSpan(mark.length() == 3 ? Typeface.BOLD_ITALIC
                            : mark.length() == 2 ? Typeface.BOLD : Typeface.ITALIC), start);
                    }
                    i = end + mark.length();
                    continue;
                }
            }
            out.append(c);
            i++;
        }
    }

    private static int closing(String text, int from, String mark) {
        if (mark.equals("`")) return text.indexOf('`', from);
        for (int i = from; i < text.length();) {
            if (text.charAt(i) == '`') {
                int end = text.indexOf('`', i + 1);
                if (end >= 0) { i = end + 1; continue; }
            }
            if (text.charAt(i) != '*') { i++; continue; }
            int end = i + 1;
            while (end < text.length() && text.charAt(end) == '*') end++;
            int count = end - i;
            if (count == mark.length()) return i;
            // A nested marker can close immediately before the outer one: *...**...***.
            if (count == 3 && mark.length() < 3) return end - mark.length();
            i = end;
        }
        return -1;
    }

    private static final class QuoteBar implements LeadingMarginSpan {
        private final int width, gap;
        QuoteBar(int width, int gap) { this.width = width; this.gap = gap; }
        @Override public int getLeadingMargin(boolean first) { return width + gap; }
        @Override public void drawLeadingMargin(Canvas canvas, Paint paint, int x, int dir, int top,
                int baseline, int bottom, CharSequence text, int start, int end, boolean first, Layout layout) {
            int color = paint.getColor();
            Paint.Style style = paint.getStyle();
            paint.setColor(0x99e8e9eb);
            paint.setStyle(Paint.Style.FILL);
            canvas.drawRect(Math.min(x, x + dir * width), top, Math.max(x, x + dir * width), bottom, paint);
            paint.setColor(color);
            paint.setStyle(style);
        }
    }
}
