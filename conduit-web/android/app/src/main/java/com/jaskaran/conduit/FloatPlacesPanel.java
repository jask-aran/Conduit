package com.jaskaran.conduit;

import android.content.Context;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.TextUtils;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Float's Workspace panel: where a new chat goes (Chat, a project, or a Workspace), searchable. */
public final class FloatPlacesPanel extends FloatPanel {
    public interface Listener {
        void placeChosen(ConduitHubClient.Place place);
        void closed();
    }

    private final Listener listener;
    private final EditText search;
    private List<ConduitHubClient.Place> places;

    public FloatPlacesPanel(Context context, ConduitHubClient hub, Listener listener) {
        super(context, hub);
        this.listener = listener;
        heading("New chat in", null);
        search = input("Search places");
        top.addView(search);
        top.addView(rule());
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { if (places != null) render(); }
            @Override public void afterTextChanged(Editable value) {}
        });
    }

    @Override protected void onOpen() { refresh(); }
    @Override protected void onClosed() { listener.closed(); }

    private void refresh() {
        places = null;
        load(hub::places, values -> {
            places = new ArrayList<>(values);
            places.sort(Comparator.comparing((ConduitHubClient.Place place) -> !place.isChat)
                .thenComparing(place -> place.isWorkspace)
                .thenComparing(place -> place.name, String.CASE_INSENSITIVE_ORDER));
            render();
        }, this::refresh);
    }

    /** Chat first, then the projects in Chat, then the Workspaces in Work, each group under its name. */
    private void render() {
        body.removeAllViews();
        String query = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        int count = 0;
        String group = null;
        for (ConduitHubClient.Place place : places) {
            String name = place.isChat ? "Chat" : place.name;
            if (!name.toLowerCase(Locale.ROOT).contains(query)) continue;
            String heading = place.isChat ? null : place.isWorkspace ? "Workspaces" : "Projects";
            if (heading != null && !heading.equals(group)) {
                TextView label = label(heading);
                label.setPadding(dp(8), dp(count == 0 ? 6 : 14), dp(8), dp(6));
                body.addView(label);
                group = heading;
            }
            LinearLayout row = column();
            rowStyle(row);
            row.setGravity(android.view.Gravity.CENTER_VERTICAL);
            row.addView(rowText(name));
            String detail = place.isChat ? "No project" : place.deviceName;
            if (detail != null) row.addView(detail(detail));
            row.setOnClickListener(v -> { close(); listener.placeChosen(place); });
            body.addView(row);
            count++;
        }
        if (count == 0) line("No places found", SECONDARY);
    }
}
