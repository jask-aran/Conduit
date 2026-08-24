import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pathUrl = (path) => new URL(`../${path}`, import.meta.url);
const source = (path) => readFile(pathUrl(path), "utf8");

test("Voice is forward-ported into the performance shell without legacy adapters", async () => {
  const [main, composer, client, settings, settingsCore, voiceCss, voiceTypes] = await Promise.all([
    source("src/client/main.tsx"),
    source("src/client/chat/composer.tsx"),
    source("src/client/chat/voice-dictation-client.ts"),
    source("src/client/settings/settings.tsx"),
    source("src/client/settings/settings-core.tsx"),
    source("src/client/settings/voice-settings.css"),
    source("src/client/chat/voice-dictation-types.ts"),
  ]);

  // Performance topology remains the owner of the visible chat shell.
  assert.match(main, /<section class="work-area-conversation"[^>]*>\s*<Transcript[\s\S]*?\/>\s*<div class="composer-stack">/);
  assert.doesNotMatch(main, /stickyFooter|sticky-footer/);
  assert.match(composer, /composer-surface-shell/);
  assert.match(composer, /data-composer-surface=\{composerSurface\(\)\}/);

  // The canonical client is current Voice directly: no backwards state map.
  assert.match(client, /export type VoiceDictationState = "idle" \| "starting" \| "listening" \| "finishing" \| "waiting" \| "transcribing"/);
  assert.match(client, /\/v0\/dictation\/stream/);
  assert.match(client, /getCaptureProfile\?:/);
  assert.match(client, /getWarmMicrophone\?:/);
  assert.equal(existsSync(pathUrl("src/client/chat/voice-dictation-client-main.ts")), false);
  assert.equal(existsSync(pathUrl("src/client/chat/voice-settings-compat.ts")), false);

  // Rebuild Composer consumes current Voice semantics natively.
  assert.match(composer, /\["starting", "listening", "finishing", "waiting", "transcribing"\]/);
  assert.match(composer, /onRuntimeReady:/);
  assert.match(composer, /onTranscriptionWaiting:/);
  assert.match(composer, /getCaptureProfile:/);
  assert.match(composer, /getWarmMicrophone:/);
  assert.match(composer, /dictationState\(\) === "listening"/);
  assert.doesNotMatch(composer, /"connecting", "active", "stopping"/);

  // Settings is one current-main-derived dialog, not Voice-mode switching.
  assert.match(settings, /Settings as SettingsCore/);
  assert.equal(existsSync(pathUrl("src/client/settings/settings-main.tsx")), false);
  assert.equal(existsSync(pathUrl("src/client/settings/settings-performance.tsx")), false);
  assert.equal(existsSync(pathUrl("src/client/settings/voice-main-bridge.css")), false);
  assert.doesNotMatch(settings, /voiceMode|CurrentMainSettings|PerformanceSettings/);
  assert.match(settingsCore, /VoiceLocalCatalogue/);
  assert.match(settingsCore, /isWarmMicrophoneActive/);
  assert.match(settingsCore, /Transcription source/);
  assert.match(main, /import type \{ VoiceDictationSettings \} from "\.\/chat\/voice-dictation-types"/);
  assert.match(composer, /import type \{ VoiceDictationSettings \} from "\.\/voice-dictation-types"/);
  assert.match(settingsCore, /import type \{ VoiceDictationSettings \} from "\.\.\/chat\/voice-dictation-types"/);
  assert.match(settings, /voiceSettings: VoiceDictationSettings/);
  assert.match(voiceTypes, /captureProfile: "raw" \| "processed"/);
  assert.match(voiceTypes, /warmMicrophone: boolean/);

  // Rebuild-only material and meteor preferences remain available.
  assert.match(settingsCore, /COMPOSER_SURFACE_OPTIONS/);
  assert.match(main, /const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field"/);
  assert.match(main, /routeKind\(\) === "chat" && meteorField\(\)/);
  assert.match(main, /meteorField=\{meteorField\(\)\}/);
  assert.doesNotMatch(voiceCss, /data-meteor-field/);
});
