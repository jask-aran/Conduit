import { Dialog } from "@/components/dialog";
import { Button as DialogButton } from "@/components/ui/controls";
import type { Accessor } from "solid-js";
import { CardRead } from "@/components/ui/card";

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
  return <Dialog alert open={Boolean(props.url())} onOpenChange={(openState) => { if (!openState) props.onClose(); }} onCloseAutoFocus={restoreFocus}
   title="Open external link?" description="This link opens outside Conduit."
    actions={<>
      <DialogButton variant="ghost" outline onClick={props.onClose}>Cancel</DialogButton>
      <DialogButton onClick={open}>Open link</DialogButton>
    </>}>
    <CardRead>{props.url()}</CardRead>
  </Dialog>;
}
