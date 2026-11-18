import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { MailFilterCheck, MailLabelRule, MailSorting, MailSplit } from "@/mail/mail";
import { Button, Field, Input, Switch } from "@/components/ui/controls";
import { SettingDetails, SettingLine, SettingValue } from "@/components/ui/overlay";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";
import { Row } from "@/components/ui/row";
import { Actions } from "@/components/ui/actions";
import { CardForm } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Icons } from "@/components/ui";
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { failure, mailApi } from "../mail/mail-api";
import { createLatest } from "../state/latest";

/** Sorting again tells clients a page at a time: the counts are read once the telling settles. */
const SETTLE_MS = 400;
/** A pause in typing long enough to ask the hub to read the filter. */
const TYPED_MS = 250;

type Editing = { kind: "split"; split?: MailSplit } | { kind: "rule"; rule?: MailLabelRule };
const threads = (n = 0) => `${n.toLocaleString()} ${n === 1 ? "thread" : "threads"}`;
const titleOf = (editing: Editing | null) => !editing ? "" : editing.kind === "split" ? editing.split ? "Edit split" : "Add a split" : editing.rule ? "Edit label rule" : "Add a label rule";

/** An account's sorting: its splits in order, its label rules and its sender routes, each written through one editor. */
export function MailSortingSettings(props: { account: string; scope?: string }) {
  const [sorting, setSorting] = createSignal<MailSorting | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [editing, setEditing] = createSignal<Editing | null>(null);
  const { confirm, prompt } = createDecisionScope(() => props.account);
  const load = () => mailApi.sorting(props.account).then((found) => { setSorting(found); setError(""); }).catch((reason) => setError(failure(reason)));
  void load();
  let soon: number | undefined;
  const heard = (event: Event) => {
    const account = (event as CustomEvent<{ account?: string }>).detail?.account;
    if (account && account !== props.account) return;
    window.clearTimeout(soon);
    soon = window.setTimeout(() => void load(), SETTLE_MS);
  };
  window.addEventListener("conduit:mail-changed", heard);
  onCleanup(() => { window.removeEventListener("conduit:mail-changed", heard); window.clearTimeout(soon); });

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try { await run(); await load(); }
    catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  };
  const splits = () => sorting()?.splits ?? [];
  const nameOf = (split: string) => splits().find((one) => one.id === split)?.name ?? split;
  const move = (at: number, by: -1 | 1) => {
    const ids = splits().map((one) => one.id);
    [ids[at], ids[at + by]] = [ids[at + by]!, ids[at]!];
    return act(() => mailApi.orderSplits(props.account, ids));
  };
  const removeSplit = async (split: MailSplit) => {
    if (!await confirm(`Delete ${split.name}? Its threads go to the splits left.`, { confirmLabel: "Delete", destructive: true })) return;
    await act(() => mailApi.removeSplit(props.account, split.id));
  };
  const rename = async (split: MailSplit) => {
    const name = (await prompt("Rename", split.name, { confirmLabel: "Rename" }))?.trim();
    if (name && name !== split.name) await act(() => mailApi.putSplit(props.account, { id: split.id, name, filter: split.filter, takes: split.takes, by: split.by }));
  };
  const removeRule = async (rule: MailLabelRule) => {
    if (!await confirm(`Delete ${rule.name}?`, { confirmLabel: "Delete", destructive: true })) return;
    await act(() => mailApi.removeLabelRule(props.account, rule.id));
  };
  const icon = (label: string, onClick: () => void, glyph: JSX.Element, disabled = () => false) =>
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={busy() || disabled()} onClick={onClick}>{glyph}</Button>;
  const add = (label: string, next: Editing) => <SettingLine plain label="">
    <Button variant="ghost" outline size="sm" disabled={busy() || !sorting()} onClick={() => setEditing(next)}><Icons.Add />{label}</Button>
  </SettingLine>;

  return <>
    <Show when={sorting()}>{(shown) => <>
      <Group title="Splits" scope={props.scope}>
        <For each={shown().splits}>{(split, at) => {
          const last = () => at() === shown().splits.length - 1;
          return <SettingLine plain label={split.name} state={last() ? "Holds the rest" : <SettingValue mono>{split.filter}</SettingValue>}>
            <Show when={!last() && !split.takes}><SettingValue>view</SettingValue></Show>
            <SettingValue mono>{threads(split.threads)}</SettingValue>
            <Show when={!last()} fallback={icon(`Rename ${split.name}`, () => void rename(split), <Icons.Edit />)}>
              {icon(`Edit ${split.name}`, () => setEditing({ kind: "split", split }), <Icons.Edit />)}
              {icon("Move up", () => void move(at(), -1), <Icons.ArrowUp />, () => at() === 0)}
              {icon("Move down", () => void move(at(), 1), <Icons.ArrowDown />, () => at() >= shown().splits.length - 2)}
              {icon(`Delete ${split.name}`, () => void removeSplit(split), <Icons.Delete />)}
            </Show>
          </SettingLine>;
        }}</For>
        {add("Add a split", { kind: "split" })}
      </Group>
      <Group title="Label rules" scope={props.scope}>
        <For each={shown().rules}>{(rule) => <SettingLine plain label={rule.name} state={<SettingValue mono>{rule.filter}</SettingValue>}>
          <SettingValue>{rule.labels.join(", ")}{rule.mirror ? " · in Gmail too" : ""}</SettingValue>
          <SettingValue mono>{threads(rule.threads)}</SettingValue>
          {icon(`Edit ${rule.name}`, () => setEditing({ kind: "rule", rule }), <Icons.Edit />)}
          {icon(`Delete ${rule.name}`, () => void removeRule(rule), <Icons.Delete />)}
        </SettingLine>}</For>
        {add("Add a rule", { kind: "rule" })}
      </Group>
      <Show when={shown().senders.length}>
        <Group title="Senders" scope={props.scope}>
          <For each={shown().senders}>{(route) => <SettingLine plain mono label={route.address} state={`to ${nameOf(route.split)}`}>
            {icon(`Stop sending ${route.address} to ${nameOf(route.split)}`, () => void act(() => mailApi.routeSender(props.account, route.address, null)), <Icons.Delete />)}
          </SettingLine>}</For>
        </Group>
      </Show>
    </>}</Show>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
    <Dialog open={Boolean(editing())} onOpenChange={(open) => { if (!open) setEditing(null); }} title={titleOf(editing())} close>
      <Show when={editing()} keyed>{(now) =>
        <Editor account={props.account} editing={now} guide={sorting()?.guide ?? ""} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}</Show>
    </Dialog>
  </>;
}

/** A split's or a label rule's name and filter, the filter read by the hub as it is typed and tried on the inbox. */
function Editor(props: { account: string; editing: Editing; guide: string; onCancel: () => void; onSaved: () => void }) {
  const split = props.editing.kind === "split" ? props.editing.split : undefined;
  const rule = props.editing.kind === "rule" ? props.editing.rule : undefined;
  const [name, setName] = createSignal(split?.name ?? rule?.name ?? "");
  const [filter, setFilter] = createSignal(split?.filter ?? rule?.filter ?? "");
  const [takes, setTakes] = createSignal(split?.takes ?? true);
  const [labels, setLabels] = createSignal(rule?.labels.join(", ") ?? "");
  const [mirror, setMirror] = createSignal(rule?.mirror ?? false);
  const [check, setCheck] = createSignal<{ filter: string; answer: MailFilterCheck } | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [refused, setRefused] = createSignal("");
  let timer: number | undefined;
  const latest = createLatest();
  const ask = (text: string) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const still = latest.next();
      const answer = (found: MailFilterCheck) => { if (still()) setCheck({ filter: text, answer: found }); };
      mailApi.checkFilter(props.account, text).then(answer, (reason) => answer({ ok: false, error: { message: failure(reason), at: -1 } }));
    }, TYPED_MS);
  };
  ask(filter());
  onCleanup(() => { window.clearTimeout(timer); latest.drop(); });

  const labelList = () => labels().split(",").map((one) => one.trim()).filter(Boolean);
  // Save waits for the hub to have read the filter as it now stands; the last answer stays shown meanwhile.
  const current = () => { const last = check(); return last?.filter === filter() ? last.answer : undefined; };
  const ready = () => Boolean(current()?.ok) && Boolean(name().trim()) && (props.editing.kind === "split" || labelList().length > 0) && !saving();
  const where = (error: { message: string; at: number }) => error.at >= 0 ? `${error.message}, at character ${error.at + 1}` : error.message;
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    const answer = current();
    if (!ready() || !answer) return;
    setSaving(true); setRefused("");
    const written = answer.canonical ?? filter().trim();
    try {
      if (props.editing.kind === "split") await mailApi.putSplit(props.account, { id: split?.id, name: name().trim(), filter: written, takes: takes(), by: split?.by ?? "person" });
      else await mailApi.putLabelRule(props.account, { id: rule?.id, name: name().trim(), filter: written, labels: labelList(), mirror: mirror(), by: rule?.by ?? "person" });
      props.onSaved();
    } catch (reason) { setRefused(failure(reason)); }
    finally { setSaving(false); }
  };

  return <CardForm onSubmit={(event) => void save(event)}>
    <Field label="Name"><Input id="mail-sorting-name" autocomplete="off" autofocus value={name()} onInput={(event) => setName(event.currentTarget.value)} /></Field>
    <Field label="Filter">
      <Input id="mail-sorting-filter" autocomplete="off" spellcheck={false} placeholder="from:@github.com OR category:updates" value={filter()}
        onInput={(event) => { setFilter(event.currentTarget.value); ask(event.currentTarget.value); }} />
    </Field>
    <Show when={check()?.answer}>{(answer) => <Show when={answer().ok} fallback={<Note tone="error">{where(answer().error ?? { message: "The filter does not read.", at: -1 })}</Note>}>
      <Note>{threads(answer().threads)}<Show when={answer().canonical && answer().canonical !== filter().trim()}> · reads as <SettingValue mono>{answer().canonical}</SettingValue></Show></Note>
      <For each={answer().sample ?? []}>{(thread) => <Row density="line" element="div" quiet label={thread.subject} meta={thread.from[0]?.name || thread.from[0]?.address} />}</For>
    </Show>}</Show>
    <Show when={props.guide}><SettingDetails summary="Filter language"><For each={props.guide.split("\n").filter((line) => line.trim())}>{(line) => <p>{line}</p>}</For></SettingDetails></Show>
    <Show when={props.editing.kind === "split"}>
      <SettingLine label="Takes its mail" title="On, its threads sit here and no later split has them; off, it only shows them">
        <Switch label="Takes its mail" checked={takes()} onChange={setTakes} />
      </SettingLine>
    </Show>
    <Show when={props.editing.kind === "rule"}>
      <Field label="Labels"><Input id="mail-sorting-labels" autocomplete="off" placeholder="Receipts, Bills" value={labels()} onInput={(event) => setLabels(event.currentTarget.value)} /></Field>
      <SettingLine label="Also write to Gmail" title="Labels are only ever added in Gmail, never taken off">
        <Switch label="Also write to Gmail" checked={mirror()} onChange={setMirror} />
      </SettingLine>
    </Show>
    <Show when={refused()}><Note tone="error">{refused()}</Note></Show>
    <Actions>
      <Button type="button" variant="ghost" outline onClick={() => props.onCancel()}>Cancel</Button>
      <Button type="submit" disabled={!ready()}>{saving() ? "Saving…" : "Save"}</Button>
    </Actions>
  </CardForm>;
}
