import { createSignal, For, Show } from "solid-js";
import { Button, Input, Textarea } from "@/components/primitives";
import type { HostUiRequest } from "../api/contracts";

type HostUiResponse = { id: string; cancelled?: boolean; confirmed?: boolean; value?: string };

function HostUiCard(props: { request: HostUiRequest; onRespond: (response: HostUiResponse) => void }) {
  const [value, setValue] = createSignal(props.request.prefill || "");
  const dismiss = () => props.onRespond({ id: props.request.id, cancelled: true });
  const submit = () => props.onRespond({ id: props.request.id, value: value() });

  return <section class="host-ui-card" aria-label={props.request.title || "Pi needs your input"}>
    <strong>{props.request.title || "Pi needs your input"}</strong>
    <Show when={props.request.message}><p>{props.request.message}</p></Show>
    <Show when={props.request.kind === "select"}>
      <div class="host-ui-options">
        <For each={props.request.options || []}>{(option) => <Button size="sm" variant="outline" onClick={() => props.onRespond({ id: props.request.id, value: option })}>{option}</Button>}</For>
      </div>
    </Show>
    <Show when={props.request.kind === "input"}>
      <Input
        aria-label={props.request.title || "Response"}
        placeholder={props.request.placeholder || ""}
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
    </Show>
    <Show when={props.request.kind === "editor"}>
      <Textarea
        aria-label={props.request.title || "Response"}
        class="host-ui-editor"
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
    </Show>
    <div class="host-ui-actions">
      <Button size="sm" variant="ghost" onClick={props.request.kind === "confirm" ? () => props.onRespond({ id: props.request.id, confirmed: false }) : dismiss}>
        {props.request.kind === "confirm" ? "Deny" : "Dismiss"}
      </Button>
      <Show when={props.request.kind === "confirm"}><Button size="sm" onClick={() => props.onRespond({ id: props.request.id, confirmed: true })}>Approve</Button></Show>
      <Show when={props.request.kind === "input" || props.request.kind === "editor"}><Button size="sm" onClick={submit}>Submit</Button></Show>
    </div>
  </section>;
}

export function HostUiRequests(props: { requests: HostUiRequest[]; onRespond: (response: HostUiResponse) => void }) {
  return <For each={props.requests.slice(0, 1)}>{(request) => <HostUiCard request={request} onRespond={props.onRespond} />}</For>;
}
