"use client";;
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Shiki uses bitflags for font styles: 1=italic, 2=bold, 4=underline
// oxlint-disable-next-line eslint(no-bitwise)
const isItalic = (fontStyle) => fontStyle && fontStyle & 1;
// oxlint-disable-next-line eslint(no-bitwise)
const isBold = (fontStyle) => fontStyle && fontStyle & 2;
const isUnderline = (fontStyle) =>
  // oxlint-disable-next-line eslint(no-bitwise)
  fontStyle && fontStyle & 4;

const addKeysToTokens = lines => lines.map((line, lineIdx) => ({
  key: `line-${lineIdx}`,
  tokens: line.map((token, tokenIdx) => ({
    key: `line-${lineIdx}-${tokenIdx}`,
    token,
  })),
}));

// Token rendering component
const TokenSpan = ({
  token
}) => (
  <span
    className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
    style={
      {
        backgroundColor: token.bgColor,
        color: token.color,
        fontStyle: isItalic(token.fontStyle) ? "italic" : undefined,
        fontWeight: isBold(token.fontStyle) ? "bold" : undefined,
        textDecoration: isUnderline(token.fontStyle) ? "underline" : undefined,
        ...token.htmlStyle
      }
    }>
    {token.content}
  </span>
);

// Line number styles using CSS counters
const LINE_NUMBER_CLASSES = cn(
  "block",
  "before:content-[counter(line)]",
  "before:inline-block",
  "before:[counter-increment:line]",
  "before:w-8",
  "before:mr-4",
  "before:text-right",
  "before:text-muted-foreground/50",
  "before:font-mono",
  "before:select-none"
);

// Line rendering component
const LineSpan = ({
  keyedLine,
  showLineNumbers
}) => (
  <span className={showLineNumbers ? LINE_NUMBER_CLASSES : "block"}>
    {keyedLine.tokens.length === 0
      ? "\n"
      : keyedLine.tokens.map(({ token, key }) => (
          <TokenSpan key={key} token={token} />
        ))}
  </span>
);

// Context
const CodeBlockContext = createContext({
  code: "",
});

// Provides the current code string to descendants (e.g. CodeBlockCopyButton)
// without requiring the full CodeBlock wrapper.
export const CodeBlockProvider = ({ code, children }) => {
  const contextValue = useMemo(() => ({ code }), [code]);
  return (
    <CodeBlockContext.Provider value={contextValue}>
      {children}
    </CodeBlockContext.Provider>
  );
};

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
const createRawTokens = code => ({
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

const CodeBlockBody = memo(({
  tokenized,
  showLineNumbers,
  className
}) => {
  const preStyle = useMemo(() => ({
    backgroundColor: tokenized.bg,
    color: tokenized.fg,
  }), [tokenized.bg, tokenized.fg]);

  const keyedLines = useMemo(() => addKeysToTokens(tokenized.tokens), [tokenized.tokens]);

  return (
    <pre
      className={cn(
        "dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm",
        className
      )}
      style={preStyle}>
      <code
        className={cn(
          "font-mono text-sm",
          showLineNumbers && "[counter-increment:line_0] [counter-reset:line]"
        )}>
        {keyedLines.map((keyedLine) => (
          <LineSpan
            key={keyedLine.key}
            keyedLine={keyedLine}
            showLineNumbers={showLineNumbers} />
        ))}
      </code>
    </pre>
  );
}, (prevProps, nextProps) =>
  prevProps.tokenized === nextProps.tokenized &&
  prevProps.showLineNumbers === nextProps.showLineNumbers &&
  prevProps.className === nextProps.className);

CodeBlockBody.displayName = "CodeBlockBody";

export const CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}) => (
  <div
    className={cn(
      "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
      className
    )}
    data-language={language}
    style={{
      containIntrinsicSize: "auto 200px",
      contentVisibility: "auto",
      ...style,
    }}
    {...props} />
);

export const CodeBlockHeader = ({
  children,
  className,
  ...props
}) => (
  <div
    className={cn(
      "flex items-center justify-between border-b bg-muted/80 px-3 py-2 text-muted-foreground text-xs",
      className
    )}
    {...props}>
    {children}
  </div>
);

export const CodeBlockTitle = ({
  children,
  className,
  ...props
}) => (
  <div className={cn("flex items-center gap-2", className)} {...props}>
    {children}
  </div>
);

export const CodeBlockFilename = ({
  children,
  className,
  ...props
}) => (
  <span className={cn("font-mono", className)} {...props}>
    {children}
  </span>
);

export const CodeBlockActions = ({
  children,
  className,
  ...props
}) => (
  <div
    className={cn("-my-1 -mr-1 flex items-center gap-2", className)}
    {...props}>
    {children}
  </div>
);

export const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false
}) => {
  // Memoized raw tokens for immediate display
  const rawTokens = useMemo(() => createRawTokens(code), [code]);

  // Synchronous cache lookup — avoids setState in effect for cached results
  const syncTokens = useMemo(
    () => highlightCode(code, language) ?? rawTokens,
    [code, language, rawTokens]
  );

  // Async highlighting result (populated after shiki loads)
  const [asyncTokens, setAsyncTokens] = useState(null);
  const asyncKeyRef = useRef({ code, language });

  // Invalidate stale async tokens synchronously during render
  if (
    asyncKeyRef.current.code !== code ||
    asyncKeyRef.current.language !== language
  ) {
    asyncKeyRef.current = { code, language };
    setAsyncTokens(null);
  }

  useEffect(() => {
    let cancelled = false;

    highlightCode(code, language, (result) => {
      if (!cancelled) {
        setAsyncTokens(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const tokenized = asyncTokens ?? syncTokens;

  return (
    <div className="relative overflow-auto">
      <CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
    </div>
  );
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}) => {
  return (
    <CodeBlockProvider code={code}>
      <CodeBlockContainer className={className} language={language} {...props}>
        {children}
        <CodeBlockContent code={code} language={language} showLineNumbers={showLineNumbers} />
      </CodeBlockContainer>
    </CodeBlockProvider>
  );
};

export const CodeBlockCopyButton = ({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef(0);
  const { code } = useContext(CodeBlockContext);

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      if (!isCopied) {
        await navigator.clipboard.writeText(code);
        setIsCopied(true);
        onCopy?.();
        timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
      }
    } catch (error) {
      onError?.(error);
    }
  }, [code, onCopy, onError, timeout, isCopied]);

  useEffect(() => () => {
    window.clearTimeout(timeoutRef.current);
  }, []);

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      className={cn("shrink-0", className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}>
      {children ?? <Icon size={14} />}
    </Button>
  );
};

export const CodeBlockLanguageSelector = (
  props
) => <Select {...props} />;

export const CodeBlockLanguageSelectorTrigger = ({
  className,
  ...props
}) => (
  <SelectTrigger
    className={cn("h-7 border-none bg-transparent px-2 text-xs shadow-none", className)}
    size="sm"
    {...props} />
);

export const CodeBlockLanguageSelectorValue = (
  props
) => <SelectValue {...props} />;

export const CodeBlockLanguageSelectorContent = ({
  align = "end",
  ...props
}) => (
  <SelectContent align={align} {...props} />
);

export const CodeBlockLanguageSelectorItem = (
  props
) => <SelectItem {...props} />;
