package com.jaskaran.conduit;

/** The transitions used by Float. Re-showing a state refreshes its layout. */
final class FloatMachine {
    enum State { HANDLE, RECORDING, STOPPING, SENDING, ERROR, SENT }
    private static final java.util.Map<State, java.util.Set<State>> ALLOWED = new java.util.EnumMap<>(State.class);
    static {
        ALLOWED.put(State.HANDLE, java.util.EnumSet.of(State.HANDLE, State.RECORDING, State.ERROR));
        // The five-minute cap completes capture without an explicit stop.
        ALLOWED.put(State.RECORDING, java.util.EnumSet.of(State.RECORDING, State.STOPPING, State.SENDING, State.ERROR));
        ALLOWED.put(State.STOPPING, java.util.EnumSet.of(State.STOPPING, State.HANDLE, State.SENDING, State.ERROR));
        ALLOWED.put(State.SENDING, java.util.EnumSet.of(State.SENDING, State.HANDLE, State.ERROR, State.SENT));
        // A start can fail after Capture is assigned; cancelling it still stops that capture.
        ALLOWED.put(State.ERROR, java.util.EnumSet.of(State.ERROR, State.HANDLE, State.STOPPING, State.SENDING));
        ALLOWED.put(State.SENT, java.util.EnumSet.of(State.SENT, State.HANDLE));
    }
    private State state = State.HANDLE;

    State state() { return state; }

    boolean show(State next) {
        if (!ALLOWED.get(state).contains(next)) {
            android.util.Log.w("ConduitFloat", "Ignored transition " + state + " -> " + next);
            return false;
        }
        state = next;
        return true;
    }
}
