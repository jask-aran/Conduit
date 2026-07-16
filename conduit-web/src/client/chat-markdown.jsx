import { memo, useEffect, useMemo, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
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
const allowedProtocols = new Set(["http:", "https:", "mailto:"]);
let mathPluginPromise;
const rehypePlugins = [
  defaultRehypePlugins.sanitize,
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

function loadMathPlugin() {
  mathPluginPromise ||= Promise.all([
    import("@streamdown/math"),
    import("katex/dist/katex.min.css"),
  ]).then(([module]) => module.createMathPlugin({ singleDollarTextMath: true }));
  return mathPluginPromise;
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
  const hasMath = /(^|[^\\])\$/.test(text);
  const [mathPlugin, setMathPlugin] = useState(null);
  useEffect(() => {
    if (!hasMath || mathPlugin) return undefined;
    let active = true;
    loadMathPlugin().then((plugin) => active && setMathPlugin(plugin));
    return () => { active = false; };
  }, [hasMath, mathPlugin]);
  const plugins = useMemo(() => ({
    ...(mathPlugin ? { math: mathPlugin } : {}),
  }), [mathPlugin]);

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
