import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("current Voice backend stays behind the performance composer shell", async () => {
  const [main, composer, adapter, currentClient, settings, performanceSettings, currentSettings, bridgeCss] = await Promise.all([
    source("src/client/main.tsx"),
    source("src/client/chat/composer.tsx"),
    source("src/client/chat/voice-dictation-client.ts"),
    source("src/client/chat/voice-dictation-client-main.ts"),
    source("src/client/settings/settings.tsx"),
    source("src/client/settings/settings-performance.tsx"),
    source("src/client/settings/settings-main.tsx"),
    source("src/client/settings/voice-main-bridge.css"),
  ]);

  assert.match(main, /<section class="work-area-conversation"[^>]*>\s*<Transcript[\s\S]*?\/>\s*<div class="composer-stack">/);
  assert.doesNotMatch(main, /stickyFooter|sticky-footer/);
  assert.match(composer, /from "\.\/voice-dictation-client"/);
  assert.doesNotMatch(composer, /voice-dictation-client-main/);
  assert.match(composer, /data-composer-surface=/);

  assert.match(adapter, /from "\.\/voice-dictation-client-main"/);
  assert.match(adapter, /state === "starting"\) return "connecting"/);
  assert.match(adapter, /state === "listening"\) return "active"/);
  assert.match(adapter, /"finishing" \|\| state === "waiting" \|\| state === "transcribing"/);
  assert.match(adapter, /getCaptureProfile:/);
  assert.match(adapter, /getWarmMicrophone:/);
  assert.match(currentClient, /export type VoiceDictationState = "idle" \| "starting" \| "listening"/);
  assert.match(currentClient, /getCaptureProfile\?:/);
  assert.match(currentClient, /getWarmMicrophone\?:/);

  assert.match(settings, /Settings as PerformanceSettings/);
  assert.match(settings, /Settings as CurrentMainSettings/);
  assert.match(settings, /open=\{Boolean\(props\.open\) && !voiceMode\(\)\}/);
  assert.match(settings, /open=\{Boolean\(props\.open\) && voiceMode\(\)\}/);
  assert.match(performanceSettings, /COMPOSER_SURFACE_OPTIONS/);
  assert.match(currentSettings, /VoiceLocalCatalogue/);
  assert.match(currentSettings, /Transcription source/);

  assert.match(settings, /conduit:meteor-field/);
  assert.match(bridgeCss, /html\[data-meteor-field="off"\] \.chat-meteors \{ display: none !important; \}/);
});
