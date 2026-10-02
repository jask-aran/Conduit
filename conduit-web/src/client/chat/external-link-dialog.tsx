import type { Accessor } from "solid-js";
import { Button } from "@/components/primitives";
import { FrostDialog } from "@/components/frost";

export function ExternalLinkDialog(props: {
  url: Accessor<string | null>;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  onFocusRestored?: () => void;
}) {
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const target = props.returnFocus?.();
    if (target?.isConnected) target.focus();
    props.onFocusRestored?.();
  };
  const open = () => {
    const url = props.url();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    props.onClose();
  };
  return <FrostDialog alert open={Boolean(props.url())} onOpenChange={(openState) => { if (!openState) props.onClose(); }} onCloseAutoFocus={restoreFocus}
    title="Open external link?" description="This link opens outside Conduit."
    actions={<>
      <Button variant="outline" onClick={props.onClose}>Cancel</Button>
      <Button onClick={open}>Open link</Button>
    </>}>
    <code class="external-link-url">{props.url()}</code>
  </FrostDialog>;
}
