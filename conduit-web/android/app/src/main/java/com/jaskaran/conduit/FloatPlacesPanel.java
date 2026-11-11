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

public final class FloatPlacesPanel extends FloatPanel {
    public interface Listener {
        void placeChosen(ConduitHubClient.Place place);
        void closed();
    }

    private final Listener listener;
    private List<ConduitHubClient.Place> places;

    public FloatPlacesPanel(Context context, ConduitHubClient hub, Listener listener) { this(context, hub, listener, false); }

    /** withJbot: placeChosen(null) is jbot. */
    public FloatPlacesPanel(Context context, ConduitHubClient hub, Listener listener, boolean withJbot) {
        super(context, hub);
        this.listener = listener;
        this.withJbot = withJbot;
        heading(withJbot ? "Send to" : "New chat in", null);
    }
    private final boolean withJbot;

    @Override protected void onOpen() { refresh(); }
    @Override protected void onClosed() { listener.closed(); }

    private void refresh() {
        places = null;
        load("places", hub::places, values -> {
            places = new ArrayList<>(values);
            // As the app's place picker: no folder first, then projects, then workspaces, each by name.
            places.sort(Comparator.comparing((ConduitHubClient.Place place) -> !place.isChat)
                .thenComparing(place -> place.isWorkspace)
                .thenComparing(place -> place.name, String.CASE_INSENSITIVE_ORDER));
            render();
        }, this::refresh);
    }

    private void render() {
        body.removeAllViews();
        if (withJbot) {
            LinearLayout jbot = iconRow(R.drawable.ic_stat_conduit, null, "jbot", null);
            jbot.setOnClickListener(v -> { close(); listener.placeChosen(null); });
            body.addView(jbot);
        }
        for (ConduitHubClient.Place place : places) {
            LinearLayout row;
            if (place.isChat) row = iconRow(R.drawable.ic_stat_conduit, null, "No folder", null);
            else if (!place.isWorkspace) row = iconRow(FloatGlyphs.icon("folder"), null, place.name, null);
            else if ("monogram".equals(place.appearanceMode))
                row = leadRow(monogram(place.appearanceValue, FloatGlyphs.colour(place.appearanceColour)), place.name, null);
            else row = iconRow(FloatGlyphs.icon(place.appearanceValue), FloatGlyphs.colour(place.appearanceColour), place.name, null);
            row.setOnClickListener(v -> { close(); listener.placeChosen(place); });
            body.addView(row);
        }
        if (places.isEmpty()) line("No places", SECONDARY);
    }
}
