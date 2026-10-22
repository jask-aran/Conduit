import { NotificationToaster, toast } from "@/components/notifications";
import { CardNote } from "@/components/ui/card";
import { Show } from "solid-js";
import { createSignal, createUniqueId, onCleanup } from "solid-js";
import { Frost } from "@/components/ui";
import { Toast, Toaster, Button } from "@/components/ui";
import { px, rounding, fg, Replay } from "../specs";
import { typeOf } from "../demos";
import { row, token, type Page } from "../model";

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

export const toastPage: Page = {
  title: "Toast",
  summary: "Raised frost at the window's edge, one sentence about what just happened: its kind a glyph in the state's colour, an action under it when there is one thing to do, a × to dismiss. Desktop: bottom right, above nothing; a phone: the top, inside the overlay's inset, clear of the composer and keyboard.",
  preview: toastScene,
  usage: `import { Toast, Toaster } from "@/components/ui/toast";

<Toaster>
  <Toast kind="success">Renamed chat to Trip notes</Toast>
</Toaster>`,
  anatomy: { phone: true, spacing: [".ui-toast"], scene: toastScene, parts: [
    { selector: ".ui-toast", name: "Raised frost", does: "--radius-surface; at most 25 units wide (a phone: its width)", from: (el) => `${rounding(el)} · ${px(`${el.getBoundingClientRect().width}px`)} wide` },
    { selector: ".ui-toast-icon", name: "its kind", does: "a glyph in the state's colour, on the first line", from: (el) => fg(el) },
    { selector: ".ui-toast-text", name: "the sentence", does: "the Row role, wrapping under its own start", from: (el) => typeOf(el) },
    { selector: ".ui-toast .ui-button[data-outline]", name: "an action, when there is one thing to do", does: "ghost outline, sm, under the sentence", from: (el) => `${px(`${el.getBoundingClientRect().height}px`)} tall` },
    { selector: ".ui-toast-close", name: "dismiss", does: "a ghost ×, muted", from: (el) => px(`${el.getBoundingClientRect().width}px`) },
    { selector: ".ui-toaster", name: "the stack", does: "newest at the edge, 0.375 units apart", from: (el) => px(getComputedStyle(el).rowGap) }
  ] },
  examples: [
    row("Dismiss and restore", "Local dismissal; action updates the sentence", () => {
          const [visible, setVisible] = createSignal(true), [opened, setOpened] = createSignal(false);
          return <Show when={visible()} fallback={<Button variant="ghost" outline onClick={() => { setOpened(false); setVisible(true); }}>Show workspace notification</Button>}><Toaster><Toast onDismiss={() => setVisible(false)} action={{ label: "Open workspace", onClick: () => setOpened(true) }}>{opened() ? "Japan workspace opened" : "This folder is the Japan workspace."}</Toast></Toaster></Show>;
        }, { surfaces: ["ground"], phone: true, code: "<Toaster><Toast onDismiss action={{ label, onClick }} /></Toaster>" }),
    row("Embedded frame", "Content uses the host frost surface", () => <Frost lift="raised"><Toast embedded description="The workspace remains available from the sidebar.">Disconnected from Desktop-Dev</Toast></Frost>, { surfaces: ["ground"], phone: true, code: '<Frost lift="raised"><Toast embedded /></Frost>' }),
    row("Live notifications", "components/notifications.tsx > Toaster > Toast embedded", () => <LiveNotifications />, { source: "components/notifications.tsx > Toaster > Toast embedded", surfaces: ["ground"] }),
    row("success", "something you did, done · glyph --live", () => <Toast kind="success">Renamed chat to Trip notes</Toast>, { surfaces: ["ground"], phone: true, code: '<Toast kind="success">' }),
    row("info", "worth knowing, nothing wrong · glyph --muted-foreground", () => <Toast kind="info">Workspace files updated</Toast>, { surfaces: ["ground"], phone: true, code: '<Toast kind="info">' }),
    row("warning", "it went ahead another way · glyph --warn", () => <Toast kind="warning">gpt-5 is unavailable. Using gpt-5-mini.</Toast>, { surfaces: ["ground"], phone: true, code: '<Toast kind="warning">' }),
    row("error", "it did not happen: an alert · glyph --destructive · role alert", () => <Toast kind="error">Could not reach the server to update.</Toast>, { surfaces: ["ground"], phone: true, code: '<Toast kind="error">' }),
    row("action", "one thing to do about it · Button ghost outline sm, under the sentence", () => <Toast kind="error" action={{ label: "Ask Runtime" }}>The model stopped: context window exceeded.</Toast>, { surfaces: ["ground"], phone: true, code: "<Toast action={{ label, onClick }}>" }),
    row("description", "an explanation under the notification · Caption role under the sentence", () => <Toast description="Large pastes are attached so they do not fill the model's context." action={{ label: "Paste inline" }}>Pasted text attached as paste.txt</Toast>, { surfaces: ["ground"], phone: true, code: "<Toast description action>" }),
    row("long", "a path or names wrap; nothing is cut · overflow-wrap anywhere", () => <Toast kind="success">Moved src/client/chat/attachment-strip.tsx to src/client/composer/</Toast>, { surfaces: ["ground"], phone: true, code: "<Toast>" }),
    row("Files", "the workspace's own file actions, and changes it notices · success, info · no action", () => <Toaster><Toast kind="info">Workspace files updated</Toast><Toast kind="success">Deleted notes/draft.md</Toast></Toaster>, { surfaces: ["ground"], phone: true, code: "workspace/workspace-files.tsx · workspace-poll.ts" }),
    row("Copied and renamed", "what a menu action did · success · no action", () => <Toast kind="success">3 chat links copied</Toast>, { surfaces: ["ground"], phone: true, code: "main.tsx" }),
    row("Model fallbacks", "a model or thinking level that is gone, and what replaced it; one at a time (id) · warning, info · 6–8 s · deduped by id", () => <Toast kind="warning">This chat's previous model gpt-5 is no longer scoped. It resumed with gpt-5-mini.</Toast>, { surfaces: ["ground"], phone: true, code: "main.tsx · state/model-settings.ts" }),
    row("Request failed", "a turn's error, with a way to ask about it · error · 12 s · action", () => <Toast kind="error" action={{ label: "Ask Runtime" }}>The model stopped: context window exceeded.</Toast>, { surfaces: ["ground"], phone: true, code: "main.tsx (diagnostic)" }),
    row("A folder that is a workspace", "an offer: open it · info · action · deduped by id", () => <Toast kind="info" action={{ label: "Open workspace" }}>This folder is the Japan workspace.</Toast>, { surfaces: ["ground"], phone: true, code: "main.tsx" }),
    row("Panes and layout", "why a pane could not open or move · info · no action", () => <Toast kind="info">There is no room for another pane.</Toast>, { surfaces: ["ground"], phone: true, code: "main.tsx" }),
    row("Settings and voice", "a setting not saved, a microphone gone · error · no action", () => <Toast kind="error">Voice not saved: the selected microphone is no longer available.</Toast>, { surfaces: ["ground"], phone: true, code: "settings/settings-core.tsx · chat/composer.tsx" })
  ],
  motion: [
    row("Removing", "The third shared motion state", () => <Replay leaves={["removing"]}>{(motion) => <Toast motion={motion()}>Workspace files updated</Toast>}</Replay>, { surfaces: ["ground"], phone: true, code: '<Toast motion="removing" />' }),
    row("arrives · leaves", "from its edge, back to it · in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave", () => <Replay leaves={["leaving"]}>{(m) => <Toast kind="success" motion={m()}>Saved to Downloads</Toast>}</Replay>, { surfaces: ["ground"], phone: true, code: "<Toast motion>" })
  ],
  tokens: [{ title: "What it reads", tokens: [
    token("--radius-surface", "toast corner"),
    token("--text-row", "sentence size"),
    token("--live", "success glyph"),
    token("--warn", "warning glyph"),
    token("--destructive", "error glyph")
  ] }],
  api: ["Toast", "Toaster", "NotificationToaster"]
};
