import { NotificationToaster, toast } from "@/components/notifications";
import { CardNote } from "@/components/ui/card";
import { createSignal, createUniqueId, onCleanup } from "solid-js";
import { Toast, Toaster, Button } from "@/components/ui";
import { InUse, FormTable, form, px, rounding, fg, Replay, type Mark, type FormRow } from "../specs";
import { typeOf } from "../demos";
import { type Family, lib } from "../model";

/* Toast: measured in use, each kind and form at each density, and every toast the app raises. */
export function LiveNotifications() {
  const toasterId = createUniqueId();
  const emitted = new Set<string | number>();
  const [actions, setActions] = createSignal(0);
  const show = (kind: "success" | "info" | "warning" | "error", repeat = false) => {
    emitted.add(toast[kind]("Example notification", {
      toasterId, id: repeat ? `${toasterId}-repeat` : undefined, duration: 8000,
      description: "The real Sonner host with the library's frost frame.",
      action: { label: "Count action", onClick: () => setActions((count) => count + 1) },
    }));
  };
  onCleanup(() => { emitted.forEach((id) => toast.dismiss(id)); });
  return <div class="g-stack">
    <div class="g-row"><Button onClick={() => show("success")}>Show success toast</Button><Button variant="ghost" outline onClick={() => show("error")}>Show error toast</Button></div>
    <div class="g-row"><Button variant="ghost" outline onClick={() => show("info", true)}>Repeat same toast</Button><Button variant="ghost" outline onClick={() => emitted.forEach((id) => toast.dismiss(id))}>Dismiss demo toasts</Button></div>
    <CardNote>Actions run: {actions()}. Hover to pause; use × or swipe to dismiss. Each notification lasts eight seconds.</CardNote>
    <NotificationToaster id={toasterId} />
  </div>;
}
export const toastScene = () => <div class="g-card-scene"><Toaster><Toast kind="info" action={{ label: "Open workspace" }}>This folder is the Japan workspace.</Toast><Toast kind="success">Renamed chat to Trip notes</Toast></Toaster></div>;
export const TOAST_MARKS: Mark[] = [
  { selector: ".ui-toast", label: "raised frost, --radius-surface; at most 25 units wide (a phone: its width)", read: (el) => `${rounding(el)} · ${px(`${el.getBoundingClientRect().width}px`)} wide` },
  { selector: ".ui-toast-icon", label: "its kind: a glyph in the state's colour, on the first line", read: (el) => fg(el) },
  { selector: ".ui-toast-text", label: "the sentence: the Row role, wrapping under its own start", read: (el) => typeOf(el) },
  { selector: ".ui-toast .ui-button[data-outline]", label: "an action, when there is one thing to do: ghost outline, sm, under the sentence", read: (el) => `${px(`${el.getBoundingClientRect().height}px`)} tall` },
  { selector: ".ui-toast-close", label: "dismiss: a ghost ×, muted", read: (el) => px(`${el.getBoundingClientRect().width}px`) },
  { selector: ".ui-toaster", label: "the stack: newest at the edge, 0.375 units apart", read: (el) => px(getComputedStyle(el).rowGap) },
];
export const TOASTS: FormRow[] = [
  form("success", "something you did, done", () => <Toast kind="success">Renamed chat to Trip notes</Toast>, '<Toast kind="success">', "glyph --live"),
  form("info", "worth knowing, nothing wrong", () => <Toast kind="info">Workspace files updated</Toast>, '<Toast kind="info">', "glyph --muted-foreground"),
  form("warning", "it went ahead another way", () => <Toast kind="warning">gpt-5 is unavailable. Using gpt-5-mini.</Toast>, '<Toast kind="warning">', "glyph --warn"),
  form("error", "it did not happen: an alert", () => <Toast kind="error">Could not reach the server to update.</Toast>, '<Toast kind="error">', "glyph --destructive · role alert"),
  form("action", "one thing to do about it", () => <Toast kind="error" action={{ label: "Ask Runtime" }}>The model stopped: context window exceeded.</Toast>, "<Toast action={{ label, onClick }}>", "Button ghost outline sm, under the sentence"),
  form("description", "an explanation under the notification", () => <Toast description="Large pastes are attached so they do not fill the model's context." action={{ label: "Paste inline" }}>Pasted text attached as paste.txt</Toast>, "<Toast description action>", "Caption role under the sentence"),
  form("long", "a path or names wrap; nothing is cut", () => <Toast kind="success">Moved src/client/chat/attachment-strip.tsx to src/client/composer/</Toast>, "<Toast>", "overflow-wrap anywhere"),
];
export const TOASTS_IN_APP: FormRow[] = [
  form("Files", "the workspace's own file actions, and changes it notices", () => <Toaster><Toast kind="info">Workspace files updated</Toast><Toast kind="success">Deleted notes/draft.md</Toast></Toaster>, "workspace/workspace-files.tsx · workspace-poll.ts", "success, info · no action"),
  form("Copied and renamed", "what a menu action did", () => <Toast kind="success">3 chat links copied</Toast>, "main.tsx", "success · no action"),
  form("Model fallbacks", "a model or thinking level that is gone, and what replaced it; one at a time (id)", () => <Toast kind="warning">This chat's previous model gpt-5 is no longer scoped. It resumed with gpt-5-mini.</Toast>, "main.tsx · state/model-settings.ts", "warning, info · 6–8 s · deduped by id"),
  form("Request failed", "a turn's error, with a way to ask about it", () => <Toast kind="error" action={{ label: "Ask Runtime" }}>The model stopped: context window exceeded.</Toast>, "main.tsx (diagnostic)", "error · 12 s · action"),
  form("A folder that is a workspace", "an offer: open it", () => <Toast kind="info" action={{ label: "Open workspace" }}>This folder is the Japan workspace.</Toast>, "main.tsx", "info · action · deduped by id"),
  form("Panes and layout", "why a pane could not open or move", () => <Toast kind="info">There is no room for another pane.</Toast>, "main.tsx", "info · no action"),
  form("Settings and voice", "a setting not saved, a microphone gone", () => <Toast kind="error">Voice not saved: the selected microphone is no longer available.</Toast>, "settings/settings-core.tsx · chat/composer.tsx", "error · no action"),
];

export const toastFamily: Family = { title: "Toast", note: "raised frost at the window's edge, one sentence about what just happened: its kind a glyph in the state's colour, an action under it when there is one thing to do, a × to dismiss. Desktop: bottom right, above nothing; a phone: the top, inside the overlay's inset, clear of the composer and keyboard", usage: `import { Toast, Toaster } from "@/components/ui/toast";

<Toaster>
  <Toast kind="success">Renamed chat to Trip notes</Toast>
</Toaster>`,
  api: ["Toast", "Toaster"],
  groups: [
    { title: "In use", note: "two toasts stacked, measured", layout: "desktop", atoms: [
      lib("toast-inuse", "Toast in use", "both", "toast", "Toaster > Toast kind action", () => <InUse scene={toastScene} marks={TOAST_MARKS} spacing={[".ui-toast"]} />, "row"),
    ] },
    { title: "Live engine", note: "the app's real notification adapter and Sonner behavior: the animated element itself is the library's frost frame, so its blur works throughout the fade, stack and swipe", layout: "desktop", atoms: [
      lib("toast-live", "Live notifications", "desktop", "toast", "components/notifications.tsx > Toaster > Toast embedded", () => <LiveNotifications />, "row"),
    ] },
    { title: "Forms", note: "each kind and form at each density", layout: "desktop", atoms: [
      lib("toast-forms", "Toast · forms × densities", "both", "toast", "Toast", () => <FormTable rows={TOASTS} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
    { title: "In the app", note: "the app raises notifications through Sonner, rendered by the shared v2 Toast: success, info, error and warning. A notification can include a description and action; duration and IDs retain Sonner behavior. Grouped by where they come from", layout: "desktop", atoms: [
      lib("toast-in-app", "Toast · in the app", "both", "toast", "client/** toast.*", () => <FormTable rows={TOASTS_IN_APP} on={["desktop", "phone"]} widths={["minmax(0, 1fr)", "360px"]} stacked />, "row"),
    ] },
    { title: "Motion", note: "its own moves: it comes in from its edge and leaves back to it, so on a phone (the top) it comes down", layout: "desktop", atoms: [
      lib("toast-motion", "Toast · motion", "both", "toast", "Toast motion", () => <FormTable rows={[form("arrives · leaves", "from its edge, back to it", () => <Replay leaves={["leaving"]}>{(m) => <Toast kind="success" motion={m()}>Saved to Downloads</Toast>}</Replay>, "<Toast motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] };
