// Shared lazy Shiki singleton. This is the one Shiki import site in the
// codebase (AGENTS.md bans a second full `shiki` bundle) — everything that
// wants highlighted code (chat-markdown's fenced code blocks via
// `@/components/ai-elements/code-block.jsx`, and the tool-card JSON
// pretty-printer via `./tool-json-block.jsx`) imports `highlightCode` from
// here so the shiki/core chunk is only ever loaded once, lazily, from
// whichever lazy-loaded consumer renders first.
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Pinned set of languages, loaded on demand from fine-grained shiki chunks.
// Vite needs literal specifiers, so this map is written out explicitly.
const languageImporters = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  json: () => import("shiki/langs/json.mjs"),
};

// Token cache
const tokensCache = new Map();

// Subscribers for async token updates
const subscribers = new Map();

const getTokensCacheKey = (code, language) => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : "";
  return `${language}:${code.length}:${start}:${end}`;
};

// Single shared highlighter instance (JS regex engine, no oniguruma/wasm),
// with only the two pinned themes preloaded. Languages are loaded lazily.
let highlighterPromise = null;

const getSharedHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import("shiki/themes/github-light.mjs"),
        import("shiki/themes/github-dark.mjs"),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
};

// Create raw tokens for immediate display while highlighting loads
export const createRawTokens = code => ({
  bg: "transparent",
  fg: "inherit",

  tokens: code.split("\n").map((line) =>
    line === ""
      ? []
      : [
          {
            color: "inherit",
            content: line
          },
        ])
});

// Synchronous highlight with callback for async results
export const highlightCode = (
  code,
  language,
  // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-callbacks)
  callback
) => {
  const tokensCacheKey = getTokensCacheKey(code, language);

  // Return cached result if available
  const cached = tokensCache.get(tokensCacheKey);
  if (cached) {
    return cached;
  }

  // Languages outside the pinned set have no grammar to load - render as
  // plain text immediately instead of kicking off async highlighting.
  const importLanguage = languageImporters[language];
  if (!importLanguage) {
    const tokenized = createRawTokens(code);
    tokensCache.set(tokensCacheKey, tokenized);
    return tokenized;
  }

  // Subscribe callback if provided
  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, new Set());
    }
    subscribers.get(tokensCacheKey)?.add(callback);
  }

  // Start highlighting in background - fire-and-forget async pattern
  getSharedHighlighter()
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then)
    .then(async (highlighter) => {
      if (!highlighter.getLoadedLanguages().includes(language)) {
        await highlighter.loadLanguage(importLanguage());
      }

      const result = highlighter.codeToTokens(code, {
        lang: language,
        themes: {
          dark: "github-dark",
          light: "github-light",
        },
      });

      const tokenized = {
        bg: result.bg ?? "transparent",
        fg: result.fg ?? "inherit",
        tokens: result.tokens,
      };

      // Cache the result
      tokensCache.set(tokensCacheKey, tokenized);

      // Notify all subscribers
      const subs = subscribers.get(tokensCacheKey);
      if (subs) {
        for (const sub of subs) {
          sub(tokenized);
        }
        subscribers.delete(tokensCacheKey);
      }
    })
    // oxlint-disable-next-line eslint-plugin-promise(prefer-await-to-then), eslint-plugin-promise(prefer-await-to-callbacks)
    .catch((error) => {
      console.error("Failed to highlight code:", error);
      subscribers.delete(tokensCacheKey);
    });

  return null;
};
