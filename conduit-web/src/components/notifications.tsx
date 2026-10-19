import { Toaster as SonnerToaster, toast as sonner } from "solid-sonner";
import { Toast, Toaster, type ToastKind } from "./ui/toast";

type Options = {
  id?: string | number;
  duration?: number;
  description?: string;
  action?: { label: string; onClick: (event: MouseEvent) => void };
};

// Sonner retains IDs, timers, pause, stacking, swipe and keyboard focus. Every
// notification is drawn by the same v2 Toast as the gallery, with no stock body.
function notify(kind: ToastKind, message: string, options: Options = {}) {
  return sonner.custom((id) => <Toast kind={kind} description={options.description}
    onDismiss={() => sonner.dismiss(id)}
    action={options.action ? { label: options.action.label, onClick: (event) => {
      options.action?.onClick(event);
      if (!event.defaultPrevented) sonner.dismiss(id);
    } } : undefined}>{message}</Toast>, { id: options.id, duration: options.duration });
}

export const toast = Object.assign((message: string, options?: Options) => notify("info", message, options), {
  success: (message: string, options?: Options) => notify("success", message, options),
  info: (message: string, options?: Options) => notify("info", message, options),
  warning: (message: string, options?: Options) => notify("warning", message, options),
  error: (message: string, options?: Options) => notify("error", message, options),
  dismiss: sonner.dismiss,
});

export const NotificationToaster = () => <Toaster host={(attrs) => <SonnerToaster {...attrs} theme="dark" toastOptions={{ unstyled: true }} />} />;
