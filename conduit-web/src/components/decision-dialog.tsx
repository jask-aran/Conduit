import { createSignal, onCleanup, Show } from "solid-js";
import { Dialog } from "./dialog";
import { CardActions, CardForm } from "./ui/card";
import { Button, Input } from "./ui/controls";

type Options = { confirmLabel?: string; destructive?: boolean; valid?: () => boolean };
type Request = { message: string; options: Options } & (
  | { kind: "confirm"; resolve: (answer: boolean) => void }
  | { kind: "prompt"; initial: string; resolve: (answer: string | null) => void }
);

/** One queue per app or gallery example. Closing restores focus before the
 * decision resumes its caller; an unmounted host cancels all pending work. */
export function createDecisionDialogs() {
  const [requests, setRequests] = createSignal<Request[]>([]);
  const confirm = (message: string, options: Options = {}) => new Promise<boolean>((resolve) => {
    setRequests((queue) => [...queue, { kind: "confirm", message, options, resolve }]);
  });
  const prompt = (message: string, initial = "", options: Options = {}) => new Promise<string | null>((resolve) => {
    setRequests((queue) => [...queue, { kind: "prompt", message, initial, options, resolve }]);
  });
  function Decision(props: { request: Request }) {
    const [open, setOpen] = createSignal(true);
    const [value, setValue] = createSignal(props.request.kind === "prompt" ? props.request.initial : "");
    let input: HTMLInputElement | undefined;
    let accepted = false;
    const close = (answer: boolean) => { accepted = answer; setOpen(false); };
    const finish = () => {
      if (requests()[0] !== props.request) return;
      const allowed = accepted && (props.request.options.valid?.() ?? true);
      setRequests((queue) => queue.slice(1));
      if (props.request.kind === "confirm") props.request.resolve(allowed);
      else props.request.resolve(allowed ? value() : null);
    };
    return <Dialog alert open={open()} title={props.request.message} onOpenChange={(next) => { if (!next) close(false); }}
      onOpenAutoFocus={(event) => {
        if (input) { event.preventDefault(); input.focus(); input.select(); }
      }} onAfterClose={finish}>
      <CardForm onSubmit={(event) => { event.preventDefault(); close(true); }}>
        <Show when={props.request.kind === "prompt"}><Input aria-label={props.request.message} ref={input} value={value()} onInput={(event) => setValue(event.currentTarget.value)} /></Show>
        <CardActions>
          <Button variant="ghost" outline autofocus={props.request.kind === "confirm"} onClick={() => close(false)}>Cancel</Button>
          <Button type="submit" variant={props.request.options.destructive ? "destructive" : "primary"}>{props.request.options.confirmLabel ?? (props.request.kind === "prompt" ? "Save" : "Continue")}</Button>
        </CardActions>
      </CardForm>
    </Dialog>;
  }
  function Host() {
    onCleanup(() => {
      const pending = requests();
      setRequests([]);
      for (const request of pending) {
        if (request.kind === "confirm") request.resolve(false);
        else request.resolve(null);
      }
    });
    return <Show when={requests()[0]} keyed>{(request) => <Decision request={request} />}</Show>;
  }
  return { confirm, prompt, Host };
}

const decisions = createDecisionDialogs();
export const confirmDialog = decisions.confirm;
export const promptDialog = decisions.prompt;
export const DecisionDialogs = decisions.Host;

/** Bind decisions to a mounted view and a stable target identity. A delayed
 * answer cannot authorize work for a different project, file or route. */
export function createDecisionScope(identity: () => string | number | null | undefined = () => null) {
  let mounted = true;
  onCleanup(() => { mounted = false; });
  const optionsFor = (options: Options) => {
    const target = identity();
    return { ...options, valid: () => mounted && identity() === target && (options.valid?.() ?? true) };
  };
  return {
    confirm: (message: string, options: Options = {}) => confirmDialog(message, optionsFor(options)),
    prompt: (message: string, initial = "", options: Options = {}) => promptDialog(message, initial, optionsFor(options)),
  };
}
