import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadModelProfiles,
  publicModelProfile,
  resolveModelProfile,
  validateModelProfiles,
} from "../src/model-profiles.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("repository model profiles route OpenAI models and other models to different static search settings", () => {
  const profiles = loadModelProfiles(path.join(repositoryRoot, "templates", "model-profiles.json"));
  assert.equal(resolveModelProfile(profiles, "openai-codex/gpt-5.6-luna").id, "openai-search");
  assert.equal(resolveModelProfile(profiles, "openai/gpt-5.4").id, "openai-search");
  assert.equal(resolveModelProfile(profiles, "anthropic/claude-opus-4-8").id, "brave-search");
  assert.deepEqual(publicModelProfile(resolveModelProfile(profiles, "anthropic/claude-opus-4-8")), {
    id: "brave-search",
    label: "Brave search",
    searchRouting: {
      providers: ["brave"],
      fallbackOn: ["transient", "quota", "network"],
    },
  });
});

test("model profile matching gives exact models precedence over provider and catch-all matches", () => {
  const profiles = validateModelProfiles({
    version: "1",
    profiles: [
      {
        id: "exact",
        label: "Exact",
        matches: ["vendor/model"],
        searchRouting: { providers: ["brave"], fallbackOn: ["network"] },
      },
      {
        id: "provider",
        label: "Provider",
        matches: ["vendor/*"],
        searchRouting: { providers: ["openai"], fallbackOn: ["network"] },
      },
      {
        id: "fallback",
        label: "Fallback",
        matches: ["*"],
        searchRouting: { providers: ["brave"], fallbackOn: ["network"] },
      },
    ],
  });
  assert.equal(resolveModelProfile(profiles, "vendor/model").id, "exact");
  assert.equal(resolveModelProfile(profiles, "vendor/other").id, "provider");
  assert.equal(resolveModelProfile(profiles, "other/model").id, "fallback");
});

test("model profile validation rejects unsafe or incomplete configuration", () => {
  const base = {
    version: "1",
    profiles: [{
      id: "fallback",
      label: "Fallback",
      matches: ["*"],
      searchRouting: { providers: ["brave"], fallbackOn: ["network"] },
    }],
  };
  assert.throws(() => validateModelProfiles({ ...base, profiles: [] }), { code: "model_profiles_invalid" });
  assert.throws(() => validateModelProfiles({ ...base, profiles: [{ ...base.profiles[0], matches: ["vendor/**"] }] }), { code: "model_profiles_invalid" });
  assert.throws(() => validateModelProfiles({ ...base, profiles: [{ ...base.profiles[0], searchRouting: { providers: ["not-a-provider"], fallbackOn: ["network"] } }] }), { code: "model_profiles_invalid" });
  assert.throws(() => validateModelProfiles({
    version: "1",
    profiles: [{ ...base.profiles[0], matches: ["vendor/*"] }],
  }), { code: "model_profiles_invalid" });
});
