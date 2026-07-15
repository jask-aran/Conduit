import { memo, useEffect, useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { createMathPlugin } from "@streamdown/math";
import "katex/dist/katex.min.css";
import { BlockPolicy, harden } from "rehype-harden";
import { Streamdown, defaultRehypePlugins } from "streamdown";
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

const controls = {
  code: { copy: true, download: false },
  table: false,
  mermaid: false,
};

const icons = { CheckIcon, CopyIcon };
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });
const allowedProtocols = new Set(["http:", "https:", "mailto:"]);
let codePluginPromise;
const rehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [harden, {
    allowedProtocols: ["http", "https", "mailto"],
    allowedLinkPrefixes: ["*"],
    allowedImagePrefixes: [],
    allowDataImages: false,
    imageBlockPolicy: BlockPolicy.textOnly,
    linkBlockPolicy: BlockPolicy.textOnly,
  }],
];

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

function loadCodePlugin() {
  codePluginPromise ||= import("@streamdown/code").then((module) => module.code);
  return codePluginPromise;
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
  const hasCodeFence = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})/.test(text);
  const [codePlugin, setCodePlugin] = useState(null);
  useEffect(() => {
    if (!hasCodeFence || codePlugin) return undefined;
    let active = true;
    loadCodePlugin().then((plugin) => active && setCodePlugin(plugin));
    return () => { active = false; };
  }, [codePlugin, hasCodeFence]);
  const plugins = useMemo(() => ({
    ...(codePlugin ? { code: codePlugin } : {}),
    math: mathPlugin,
  }), [codePlugin]);

  return <Streamdown
    caret="block"
    className="chat-markdown"
    controls={controls}
    icons={icons}
    isAnimating={streaming}
    lineNumbers
    linkSafety={linkSafety}
    mode={streaming ? "streaming" : "static"}
    plugins={plugins}
    rehypePlugins={rehypePlugins}
    urlTransform={safeUrlTransform}
  >
    {text}
  </Streamdown>;
});
