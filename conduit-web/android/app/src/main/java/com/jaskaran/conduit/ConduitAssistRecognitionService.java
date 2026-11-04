package com.jaskaran.conduit;

import android.content.Intent;
import android.os.RemoteException;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;

/** Required assistant metadata target. Dictation remains with Float. */
public final class ConduitAssistRecognitionService extends RecognitionService {
    @Override protected void onStartListening(Intent intent, Callback callback) {
        try { callback.error(SpeechRecognizer.ERROR_CLIENT); }
        catch (RemoteException ignored) {}
    }
    @Override protected void onStopListening(Callback callback) {}
    @Override protected void onCancel(Callback callback) {}
}
