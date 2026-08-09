import type { Accessor } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { Button } from "@/components/primitives";

export function ExternalLinkDialog(props: {
  url: Accessor<string | null>;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  onFocusRestored?: () => void;
}) {
  const restoreFocus = () => {
    const target = props.returnFocus?.();
    if (target?.isConnected) target.focus();
    props.onFocusRestored?.();
  };
  const open = () => {
    const url = props.url();
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    props.onClose();
  };
  return <KAlertDialog.Root open={Boolean(props.url())} onOpenChange={(openState) => { if (!openState) props.onClose(); }}>
    <KAlertDialog.Portal><KAlertDialog.Content data-state={props.url() ? "open" : "closed"} class="external-link-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
      <div class="external-link-dialog-card">
        <KAlertDialog.Title>Open external link?</KAlertDialog.Title>
        <KAlertDialog.Description>This link opens outside Conduit.</KAlertDialog.Description>
        <code class="external-link-url">{props.url()}</code>
        <div class="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>Cancel</Button>
          <Button onClick={open}>Open link</Button>
        </div>
      </div>
    </KAlertDialog.Content></KAlertDialog.Portal>
  </KAlertDialog.Root>;
}
