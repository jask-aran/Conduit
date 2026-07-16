import { useEffect, useRef, useState } from "react";
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

export function RenderedMarkdown({ html = "" }) {
  const root = useRef(null);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (html.includes('class="katex')) import("katex/dist/katex.min.css");
    const element = root.current;
    if (!element) return undefined;
    const enhanceCodeBlocks = () => {
      for (const pre of element.querySelectorAll("pre")) {
        if (pre.querySelector(".server-code-copy")) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "server-code-copy";
        button.setAttribute("aria-label", "Copy code");
        button.textContent = "Copy";
        pre.append(button);
      }
    };
    enhanceCodeBlocks();
    const observer = new MutationObserver(enhanceCodeBlocks);
    observer.observe(element, { childList: true, subtree: true });
    const click = async (event) => {
      const anchor = event.target.closest("a[data-conduit-link]");
      if (anchor) {
        event.preventDefault();
        const target = new URL(anchor.href, location.href);
        if (target.origin === location.origin || target.protocol === "mailto:") location.assign(anchor.href);
        else setLink(anchor.href);
        return;
      }
      const button = event.target.closest(".server-code-copy");
      if (button) {
        const text = button.parentElement.querySelector("code")?.textContent || "";
        await navigator.clipboard.writeText(text);
        setCopied(text);
        button.textContent = "Copied";
        setTimeout(() => { button.textContent = "Copy"; setCopied(""); }, 1200);
      }
    };
    element.addEventListener("click", click);
    return () => {
      observer.disconnect();
      element.removeEventListener("click", click);
    };
  }, [html]);

  return <>
    <div ref={root} className="chat-markdown server-markdown" dangerouslySetInnerHTML={{ __html: html }} />
    <span className="sr-only" aria-live="polite">{copied ? "Code copied" : ""}</span>
    <AlertDialog open={Boolean(link)} onOpenChange={(open) => !open && setLink("")}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open external link?</AlertDialogTitle>
          <AlertDialogDescription>This link opens outside Conduit.</AlertDialogDescription>
        </AlertDialogHeader>
        <code className="external-link-url">{link}</code>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => { window.open(link, "_blank", "noopener,noreferrer"); setLink(""); }}>Open link</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
