package com.jaskaran.conduit;

import org.json.JSONObject;

/** A destination that can be saved with a pending Float recording. */
public final class FloatTarget {
    public enum Kind { JBOT, NEW_CHAT, CHAT }

    public final Kind kind;
    public final String projectId;
    public final String chatId;
    public final String label;

    private FloatTarget(Kind kind, String projectId, String chatId, String label) {
        this.kind = kind;
        this.projectId = projectId;
        this.chatId = chatId;
        this.label = label;
    }

    public static FloatTarget jbot() {
        return new FloatTarget(Kind.JBOT, null, null, "jbot");
    }

    public static FloatTarget newChat(String projectId, String label) {
        if (projectId != null && projectId.trim().isEmpty()) throw new IllegalArgumentException("Missing project ID");
        return new FloatTarget(Kind.NEW_CHAT, projectId, null, label == null ? "New chat" : label);
    }

    public static FloatTarget chat(String chatId, String label) {
        if (chatId == null || chatId.trim().isEmpty()) throw new IllegalArgumentException("Missing chat ID");
        return new FloatTarget(Kind.CHAT, null, chatId, label == null ? "Chat" : label);
    }

    public String toJson() {
        try {
            return new JSONObject().put("kind", kind.name()).put("projectId", projectId == null ? JSONObject.NULL : projectId)
                .put("chatId", chatId == null ? JSONObject.NULL : chatId).put("label", label).toString();
        } catch (org.json.JSONException error) {
            throw new IllegalStateException("Could not save Float target", error);
        }
    }

    public static FloatTarget fromJson(String value) {
        try {
            JSONObject json = new JSONObject(value);
            if (!(json.opt("kind") instanceof String) || !(json.opt("label") instanceof String)
                || (!json.isNull("projectId") && !(json.opt("projectId") instanceof String))
                || (!json.isNull("chatId") && !(json.opt("chatId") instanceof String))) return jbot();
            Kind kind = Kind.valueOf(json.getString("kind"));
            String label = json.getString("label");
            switch (kind) {
                case JBOT: return jbot();
                case NEW_CHAT: return newChat(json.isNull("projectId") ? null : json.getString("projectId"), label);
                case CHAT: return chat(json.getString("chatId"), label);
                default: return jbot();
            }
        } catch (Exception ignored) {
            return jbot();
        }
    }
}
