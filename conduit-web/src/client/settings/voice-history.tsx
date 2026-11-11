import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { CloudIcon } from "lucide-solid";
import { Button, Fact, HarnessMark, Icons, Loading, Note, OverlayFacts, Row, Segmented, SettingList } from "@/components/ui";
import { DashDay, GroupSwitches } from "@/components/ui/dashboard";
import { Select } from "@/components/ui/menus";
import { clearDictationHistory, dictationHistory, type DictationRecord } from "../chat/voice-dictation-history";
import { clientName } from "./sign-ins-settings";

const SERVICES: Record<DictationRecord["service"], { name: string; audio: string }> = {
  hex: { name: "Hex on that computer", audio: "Nowhere: it stayed on that computer" },
  hub: { name: "Private, on the hub", audio: "The hub" },
  cloud: { name: "Cloud", audio: "The hub, then its cloud provider" },
};
const glyph = (service: DictationRecord["service"]) => service === "hex" ? <HarnessMark id="hex" /> : service === "hub" ? <Icons.Server /> : <CloudIcon />;
const from = (record: DictationRecord) => record.client ? clientName(record.client) : "An unknown device";
const dayOf = (at: string) => {
  const day = new Date(at), today = new Date(), yesterday = new Date(Date.now() - 86_400_000);
  return day.toDateString() === today.toDateString() ? "Today" : day.toDateString() === yesterday.toDateString() ? "Yesterday" : day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
};
const timeOf = (at: string) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Every dictation the hub has been told of, from every device: its text and what transcribed it. */
export default function VoiceHistory() {
  const [entries, { mutate, refetch }] = createResource(dictationHistory);
  const [only, setOnly] = createSignal<"all" | "here">("all");
  const [device, setDevice] = createSignal("");
  const [open, setOpen] = createSignal<DictationRecord | null>(null);
  const all = () => entries() || [];
  const devices = createMemo(() => [...new Set(all().map(from))]);
  const shown = createMemo(() => all().filter((record) => only() === "here" ? record.here : !device() || from(record) === device()));
  const days = createMemo(() => {
    const groups: { day: string; records: DictationRecord[] }[] = [];
    for (const record of shown()) {
      const day = dayOf(record.at);
      if (groups.at(-1)?.day === day) groups.at(-1)!.records.push(record); else groups.push({ day, records: [record] });
    }
    return groups;
  });
  const clear = async () => { await clearDictationHistory().catch(() => {}); mutate([]); void refetch(); };
  return <Show when={!entries.loading} fallback={<Loading>Loading dictations…</Loading>}>
    <Show when={!entries.error} fallback={<Note tone="error">The hub did not give its dictation history.</Note>}>
      <Show when={open()} fallback={<>
        <SettingList head={<>
          <GroupSwitches><Segmented arrows label="Dictations" value={only()} onChange={setOnly} options={[
            { value: "all", label: "All", count: all().length }, { value: "here", label: "This device", count: all().filter((record) => record.here).length }]} /></GroupSwitches>
          <Show when={only() === "all" && devices().length > 1}><Select bare aria-label="From device" value={device()} onChange={(event) => setDevice(event.currentTarget.value)}>
            <option value="">All devices</option><For each={devices()}>{(name) => <option value={name}>{name}</option>}</For></Select></Show>
          <Show when={all().length}><Button variant="ghost" size="sm" onClick={() => void clear()}>Clear</Button></Show>
        </>}>
          <For each={days()}>{(group) => <><DashDay>{group.day}</DashDay><For each={group.records}>{(record) =>
            <Row density="trail" element="button" lead={glyph(record.service)} label={record.text} detail={`${SERVICES[record.service].name}${record.model ? ` · ${record.model}` : ""} · ${from(record)}`} meta={timeOf(record.at)} onClick={() => setOpen(record)} />}</For></>}</For>
        </SettingList>
        <Show when={!shown().length}><Note>{all().length ? "No dictations from this device yet." : "Dictations appear here once you finish one."}</Note></Show>
      </>}>{(record) => <>
        <SettingList head={<Button variant="ghost" size="sm" onClick={() => setOpen(null)}><Icons.Back /> All dictations</Button>}><p>{record().text}</p></SettingList>
        <OverlayFacts title="This dictation">
          <Fact label="Transcribed by" value={`${SERVICES[record().service].name}${record().model ? ` · ${record().model}` : ""}`} />
          <Fact label="Audio went to" value={SERVICES[record().service].audio} />
          <Fact label="Spoken on" value={`${from(record())}${record().here ? " (this device)" : ""}`} />
          <Fact label="When" value={`${new Date(record().at).toLocaleString()} · ${record().seconds} s`} />
        </OverlayFacts>
        <div><Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(record().text).catch(() => {})}><Icons.Copy /> Copy</Button></div>
      </>}</Show>
    </Show>
  </Show>;
}
