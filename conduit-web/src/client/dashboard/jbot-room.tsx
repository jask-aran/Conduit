import { onCleanup, onMount, Show, type JSX } from "solid-js";
import { AgentAvatar, Icons, SheetFill } from "@/components/ui";
import type { MarkdownRendererId } from "../chat/markdown-settings";
import { agentView, refreshAgent } from "../state/agent";
import { JbotMessages, useJbotMessages } from "./jbot-messages";
import { SplitDashboard, SplitEmpty, SplitHeader, SplitQuickActions } from "./primitives/split";

const DIAL: Record<string, string> = { quiet: "Quiet", normal: "Normal", chatty: "Chatty" };

/** The message log and home-thread composer, without the dashboard's groups. */
export function JbotRoom(props: {
  header: (title: string) => JSX.Element;
  onOpenPage: () => void;
  onOpenThread?: () => void;
  markdownRenderer: MarkdownRendererId;
  composer?: JSX.Element;
  working?: boolean;
  threadChanged?: unknown;
}) {
  const log = useJbotMessages(() => props.threadChanged);
  const name = () => agentView()?.settings?.name || "Agent";
  const spent = () => {
    const settings = agentView()?.settings;
    return settings ? `$${(agentView()?.spentToday || 0).toFixed(2)} of $${settings.budgetUsdPerDay.toFixed(2)} today` : null;
  };
  const running = () => {
    const count = agentView()?.attention?.working?.runs.length;
    return count ? `${count} running` : null;
  };
  onMount(() => {
    void refreshAgent();
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void refreshAgent(); }, 10_000);
    onCleanup(() => window.clearInterval(tick));
  });

  return <SheetFill data-jbot-room="">
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        <SplitDashboard page="Agent" room label={`Messages with ${name()}`}
          header={<SplitHeader title={name()} glyph={<AgentAvatar />} context={[DIAL[agentView()?.settings?.dial || ""], spent(), running()]} />}
          quickActions={<SplitQuickActions items={[
            { icon: <Icons.Agent />, label: `${name()}'s page`, onClick: props.onOpenPage },
            ...(props.onOpenThread ? [{ icon: <Icons.Chat />, label: "Open thread", onClick: () => props.onOpenThread?.() }] : []),
          ]} />}
          conversation={<JbotMessages messages={log.messages()} renderer={props.markdownRenderer} name={name()} working={props.working} />}
          composer={props.composer} />
      </Show>
    </Show>
  </SheetFill>;
}
