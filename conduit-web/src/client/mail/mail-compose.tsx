import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { MailDraft, MailDraftInput } from "@/mail/mail";
import { Button, ComposerField, ComposerLine, DesktopComposer, DraftState, Icons, Spinner, TextArea, Toolbar } from "@/components/ui";
import { toast } from "@/components/ui/notifications";
import { failure, formatParties, mailApi, parseParties } from "./mail-api";

/** How long typing rests before the draft is saved. */
export const DRAFT_SAVE_MS = 800;

/**
 * A draft being written: its addresses (Cc and Bcc shown once asked for or filled), the subject where it is a new message or a
 * forward, and the text. Every edit is saved after a quiet moment, at once when focus leaves and before sending. `onDone`: it was
 * sent or discarded.
 */
export function DraftComposer(props: { draft: MailDraft; subject?: boolean; autofocus?: boolean; onDone: () => void }) {
  const draft = props.draft;
  const [to, setTo] = createSignal(formatParties(draft.to));
  const [cc, setCc] = createSignal(formatParties(draft.cc));
  const [bcc, setBcc] = createSignal(formatParties(draft.bcc));
  const [showCc, setShowCc] = createSignal(draft.cc.length > 0);
  const [showBcc, setShowBcc] = createSignal(draft.bcc.length > 0);
  const [subject, setSubject] = createSignal(draft.subject);
  const [text, setText] = createSignal(draft.text);
  const [state, setState] = createSignal<MailDraft["state"]>(draft.state);
  const [error, setError] = createSignal(draft.error);
  const [sending, setSending] = createSignal(false);
  let pending: MailDraftInput = {}, timer = 0, saving: Promise<void> = Promise.resolve(), field: HTMLTextAreaElement | undefined;

  const flush = () => {
    window.clearTimeout(timer);
    if (!Object.keys(pending).length) return saving;
    const input = pending;
    pending = {};
    setState("saving");
    saving = saving.then(() => mailApi.saveDraft(draft.id, input))
      .then((saved) => { if (!Object.keys(pending).length) { setState(saved.state); setError(saved.error); } })
      .catch((reason) => { pending = { ...input, ...pending }; setState("failed"); setError(failure(reason)); });
    return saving;
  };
  const edit = (input: MailDraftInput) => {
    pending = { ...pending, ...input };
    setState("saving");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), DRAFT_SAVE_MS);
  };
  // The hub says when its copy reaches the source (or fails to): the state follows, the words being written stay.
  const heard = (event: Event) => {
    const detail = (event as CustomEvent<{ account: string }>).detail;
    if (detail?.account !== draft.account || Object.keys(pending).length || sending()) return;
    void mailApi.drafts(draft.account).then((drafts) => {
      const now = drafts.find((one) => one.id === draft.id);
      if (now && !Object.keys(pending).length && !sending()) { setState(now.state); setError(now.error); }
    }).catch(() => {});
  };
  window.addEventListener("conduit:mail-changed", heard);
  onCleanup(() => { window.removeEventListener("conduit:mail-changed", heard); void flush(); });
  onMount(() => { if (props.autofocus) field?.focus(); });

  const send = async () => {
    setSending(true);
    try {
      await flush();
      if (state() === "failed") return;
      await mailApi.sendDraft(draft.id);
      toast.success("Sent");
      props.onDone();
    } catch (reason) { setState("failed"); setError(failure(reason)); }
    finally { setSending(false); }
  };
  const discard = async () => {
    window.clearTimeout(timer);
    pending = {};
    try { await mailApi.removeDraft(draft.id); props.onDone(); }
    catch (reason) { toast.error(failure(reason)); }
  };
  const parties = (set: (value: string) => void, key: "to" | "cc" | "bcc") => (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    set(event.currentTarget.value);
    edit({ [key]: parseParties(event.currentTarget.value) });
  };
  const more = () => <>
    <Show when={!showCc()}><Button variant="ghost" size="sm" onClick={() => setShowCc(true)}>Cc</Button></Show>
    <Show when={!showBcc()}><Button variant="ghost" size="sm" onClick={() => setShowBcc(true)}>Bcc</Button></Show>
  </>;

  return <div onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void flush(); }}>
    <DesktopComposer>
      <ComposerLine id={`${draft.id}-to`} label="To" value={to()} onInput={parties(setTo, "to")} placeholder="Name <address>, …" end={more()} />
      <Show when={showCc()}><ComposerLine id={`${draft.id}-cc`} label="Cc" value={cc()} onInput={parties(setCc, "cc")} /></Show>
      <Show when={showBcc()}><ComposerLine id={`${draft.id}-bcc`} label="Bcc" value={bcc()} onInput={parties(setBcc, "bcc")} /></Show>
      <Show when={props.subject}><ComposerLine id={`${draft.id}-subject`} label="Subject" value={subject()} onInput={(event) => { setSubject(event.currentTarget.value); edit({ subject: event.currentTarget.value }); }} /></Show>
      <ComposerField><TextArea ref={(element: HTMLTextAreaElement) => { field = element; }} aria-label="Message" placeholder="Write…" value={text()}
        onInput={(event) => { setText(event.currentTarget.value); edit({ text: event.currentTarget.value }); }} /></ComposerField>
      <Toolbar
        end={<Button variant="ghost" size="icon-sm" aria-label="Discard draft" title="Discard draft" disabled={sending()} onClick={() => void discard()}><Icons.Delete /></Button>}
        aside={<DraftState state={sending() ? "sending" : state()} error={error()} />}
        primary={<Button variant="ghost" size="icon-sm" aria-label="Send" title="Send" disabled={sending() || !parseParties(to()).length} onClick={() => void send()}>
          <Show when={sending()} fallback={<Icons.Send />}><Spinner /></Show></Button>} />
    </DesktopComposer>
  </div>;
}
