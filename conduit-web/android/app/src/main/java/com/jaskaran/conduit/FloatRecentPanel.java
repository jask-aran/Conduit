package com.jaskaran.conduit;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Recent replies and an answer composer in one overlay window. */
public final class FloatRecentPanel extends FloatPanel {
    public interface Listener {
        void answerByVoice(ConduitHubClient.RecentChat chat);
        void answerTyped(ConduitHubClient.RecentChat chat, String text);
        void openInConduit(ConduitHubClient.RecentChat chat);
        void closed();
    }

    private final Listener listener;
    private List<ConduitHubClient.RecentChat> chats;
    private ConduitHubClient.RecentChat selected;
    private final List<View> dots = new ArrayList<>();
    private ValueAnimator pulse;
    private EditText answer;
    private ImageButton send, mic;
    private TextView status, open;
    private boolean sending;

    public FloatRecentPanel(Context context, ConduitHubClient hub, Listener listener) {
        super(context, hub);
        this.listener = listener;
        heading("Recent", null);
    }

    @Override protected void onOpen() { refresh(); }
    @Override protected void onClosed() { listener.closed(); }
    @Override protected void onClosing() { stopPulse(); }

    private void refresh() { load(() -> hub.recentChats(20), values -> { chats = values; showList(); }, this::refresh); }

    private void stopPulse() {
        if (pulse != null) { pulse.cancel(); pulse = null; }
        dots.clear();
    }

    private void showList() {
        if (sending) return;
        stopPulse();
        selected = null;
        stopInput();
        heading("Recent", null);
        footer.removeAllViews();
        body.removeAllViews();
        scroll.scrollTo(0, 0);
        if (chats.isEmpty()) line("No recent chats", SECONDARY);
        for (ConduitHubClient.RecentChat chat : chats) {
            LinearLayout row = column();
            rowStyle(row);
            TextView title = text(title(chat), 15, PRIMARY);
            title.setSingleLine(true);
            title.setEllipsize(TextUtils.TruncateAt.END);
            row.addView(title);
            LinearLayout meta = new LinearLayout(context);
            meta.setGravity(Gravity.CENTER_VERTICAL);
            TextView project = text(chat.projectName, 13, SECONDARY);
            project.setSingleLine(true);
            project.setEllipsize(TextUtils.TruncateAt.END);
            meta.addView(project, new LinearLayout.LayoutParams(0, -2, 1));
            if ("running".equals(chat.liveStatus)) {
                View dot = new View(context);
                GradientDrawable circle = new GradientDrawable();
                circle.setShape(GradientDrawable.OVAL);
                circle.setColor(PRIMARY);
                dot.setBackground(circle);
                dot.setContentDescription("Generating");
                dot.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
                LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(dp(5), dp(5));
                size.setMargins(dp(8), 0, dp(5), 0);
                meta.addView(dot, size);
                dots.add(dot);
            }
            TextView time = text(relativeTime(chat.lastMessageAt), 13, SECONDARY);
            time.setPadding(dp(4), 0, 0, 0);
            meta.addView(time);
            row.addView(meta);
            if (chat.latestReply != null) {
                TextView preview = text(chat.latestReply.text, 13, SECONDARY);
                preview.setMaxLines(2);
                preview.setEllipsize(TextUtils.TruncateAt.END);
                preview.setPadding(0, dp(4), 0, 0);
                row.addView(preview);
            }
            row.setOnClickListener(v -> showReply(chat));
            body.addView(row);
        }
        if (!dots.isEmpty()) {
            pulse = ValueAnimator.ofFloat(.35f, 1f);
            pulse.setDuration(800);
            pulse.setRepeatMode(ValueAnimator.REVERSE);
            pulse.setRepeatCount(ValueAnimator.INFINITE);
            pulse.addUpdateListener(value -> { for (View dot : dots) dot.setAlpha((float) value.getAnimatedValue()); });
            pulse.start();
        }
    }

    private void showReply(ConduitHubClient.RecentChat chat) {
        stopPulse();
        selected = chat;
        heading(title(chat), this::showList);
        body.removeAllViews();
        TextView reply = text(FloatMarkdown.render(context, chat.latestReply == null ? "No reply yet" : chat.latestReply.text), 15, PRIMARY);
        reply.setPadding(dp(16), dp(8), dp(16), dp(16));
        reply.setLineSpacing(0, 1.15f);
        body.addView(reply);
        scroll.scrollTo(0, 0);
        footer.removeAllViews();
        open = button("Open in Conduit", () -> listener.openInConduit(chat));
        footer.addView(open);
        LinearLayout compose = new LinearLayout(context);
        compose.setGravity(Gravity.CENTER_VERTICAL);
        answer = input("Answer…");
        answer.setImeOptions(EditorInfo.IME_ACTION_SEND);
        answer.setOnEditorActionListener((v, action, event) -> {
            if (action != EditorInfo.IME_ACTION_SEND) return false;
            submit();
            return true;
        });
        compose.addView(answer, new LinearLayout.LayoutParams(0, dp(48), 1));
        send = icon(R.drawable.float_send, "Send answer", true);
        send.setOnClickListener(v -> submit());
        compose.addView(send, new LinearLayout.LayoutParams(dp(48), dp(48)));
        mic = icon(R.drawable.float_mic, "Answer by voice", false);
        mic.setOnClickListener(v -> { close(); listener.answerByVoice(chat); });
        compose.addView(mic, new LinearLayout.LayoutParams(dp(48), dp(48)));
        footer.addView(compose);
        status = text("", 13, SECONDARY);
        status.setPadding(dp(16), dp(4), dp(16), dp(8));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setVisibility(View.GONE);
        footer.addView(status);
    }

    private ImageButton icon(int drawable, String description, boolean filled) {
        ImageButton button = new ImageButton(context);
        button.setImageResource(drawable);
        button.setImageTintList(ColorStateList.valueOf(filled ? 0xff3a3b3f : SECONDARY));
        button.setContentDescription(description);
        rowStyle(button);
        button.setPadding(dp(15), dp(15), dp(15), dp(15));
        if (filled) {
            GradientDrawable circle = new GradientDrawable();
            circle.setShape(GradientDrawable.OVAL);
            circle.setColor(PRIMARY);
            button.setBackground(new android.graphics.drawable.InsetDrawable(circle, dp(8)));
        }
        return button;
    }

    private void submit() {
        if (sending || !isOpen() || selected == null) return;
        String value = answer.getText().toString().trim();
        if (value.isEmpty()) return;
        sending = true;
        setComposerEnabled(false);
        stopInput();
        status.setTextColor(SECONDARY);
        status.setText("Sending…");
        status.setVisibility(View.VISIBLE);
        listener.answerTyped(selected, value);
    }

    private void setComposerEnabled(boolean enabled) {
        answer.setEnabled(enabled);
        send.setEnabled(enabled);
        mic.setEnabled(enabled);
        open.setEnabled(enabled);
    }

    /** Called by the sender after answerTyped succeeds. Safe from any thread. */
    public void sent() {
        main.post(() -> { if (isOpen() && sending) close(); });
    }

    /** Keeps the typed answer for retry. Safe from any thread; ignored after close. */
    public void failed(String message) {
        main.post(() -> {
            if (!isOpen() || !sending) return;
            sending = false;
            setComposerEnabled(true);
            status.setTextColor(PRIMARY);
            status.setText(message);
            status.setVisibility(View.VISIBLE);
        });
    }

    /** Uses the same instance identifier and route extras as a push notification. */
    public static void openInConduit(Context context, String instance, ConduitHubClient.RecentChat chat) {
        Intent intent = new Intent(context, MainActivity.class)
            .setData(new Uri.Builder().scheme("conduit-push").appendPath(instance + ":" + chat.chatId).build())
            .putExtra(ConduitPushPlugin.INSTANCE, instance)
            .putExtra(ConduitPushPlugin.PATH, "/chat/" + chat.chatId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private static String title(ConduitHubClient.RecentChat chat) {
        return chat.title == null || chat.title.trim().isEmpty() ? "Untitled" : chat.title;
    }

    private static String relativeTime(String value) {
        if (value == null) return "";
        Date date = null;
        for (String pattern : new String[] { "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX" }) {
            SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
            date = format.parse(value, new ParsePosition(0));
            if (date != null) break;
        }
        if (date == null) return "";
        long age = Math.max(0, System.currentTimeMillis() - date.getTime());
        if (age < 60_000) return "now";
        if (age < 3_600_000) return (age / 60_000) + "m";
        if (age < 86_400_000) return (age / 3_600_000) + "h";
        if (age < 6 * 86_400_000L) return new SimpleDateFormat("EEE", Locale.getDefault()).format(date);
        return new SimpleDateFormat("d MMM", Locale.getDefault()).format(date);
    }
}
