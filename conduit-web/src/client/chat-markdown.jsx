import { memo, useMemo } from "react";
import { createMathPlugin } from "@streamdown/math";
import "katex/dist/katex.min.css";
import { Streamdown } from "streamdown";
import { Artifact, ArtifactActions, ArtifactContent, ArtifactHeader, ArtifactTitle } from "@/components/ai-elements/artifact";
import { CodeBlockContent, CodeBlockCopyButton, CodeBlockProvider } from "@/components/ai-elements/code-block";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const allowedProtocols = new Set(["http:", "https:", "mailto:"]);
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });

function safeUrlTransform(url, key) {
  if (key === "src") return null;
  if (url.startsWith("#")) return url;
  try {
    const target = new URL(url, window.location.href);
    return allowedProtocols.has(target.protocol) ? url : null;
  } catch {
    return null;
  }
}

const languageAliases = { js: "javascript", ts: "typescript", py: "python", sh: "bash", md: "markdown", yml: "yaml" };

function AiCodeBlock({ children, node, ...props }) {
  const className = node?.properties?.className;
  const languageClass = Array.isArray(className) ? className.find((value) => String(value).startsWith("language-")) : className;
  const languageName = String(languageClass || "").replace(/^language-/, "").toLowerCase();
  const language = languageAliases[languageName] || languageName || "text";
  const code = String(children || "").replace(/\n$/, "");
  if (!("data-block" in props) && !languageClass) return <code {...props}>{children}</code>;
  return <Artifact data-language={language}>
    <ArtifactHeader>
      <ArtifactTitle>{language}</ArtifactTitle>
      <ArtifactActions>
        <CodeBlockProvider code={code}>
          <CodeBlockCopyButton
            aria-label="Copy code"
            className="size-8 p-0 text-muted-foreground hover:text-foreground"
            size="sm"
          />
        </CodeBlockProvider>
      </ArtifactActions>
    </ArtifactHeader>
    <ArtifactContent className="p-0">
      <CodeBlockContent code={code} language={language} showLineNumbers />
    </ArtifactContent>
  </Artifact>;
}

function ExternalLinkDialog({ isOpen, onClose, onConfirm, url }) {
  function confirm() {
    onConfirm();
    onClose();
  }

  return <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Open external link?</AlertDialogTitle>
        <AlertDialogDescription>
          This link opens outside Conduit.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <code className="external-link-url">{url}</code>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={confirm}>Open link</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

const linkSafety = {
  enabled: true,
  onLinkCheck(url) {
    try {
      const target = new URL(url, window.location.href);
      return target.origin === window.location.origin || target.protocol === "mailto:";
    } catch {
      return false;
    }
  },
  renderModal: (props) => <ExternalLinkDialog {...props} />,
};

export const ChatMarkdown = memo(function ChatMarkdown({ children = "", streaming = false }) {
  const text = String(children || "");
  const plugins = useMemo(() => ({ math: mathPlugin }), []);

  return <Streamdown
    caret="block"
    className="chat-markdown"
    components={{ code: AiCodeBlock }}
    isAnimating={streaming}
    linkSafety={linkSafety}
    mode={streaming ? "streaming" : "static"}
    plugins={plugins}
    urlTransform={safeUrlTransform}
  >
    {text}
  </Streamdown>;
});
