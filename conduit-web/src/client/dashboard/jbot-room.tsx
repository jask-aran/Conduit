import { onCleanup, onMount, Show, type JSX } from "solid-js";
import { SheetFill } from "@/components/ui";
import type { MarkdownRendererId } from "../chat/markdown-settings";
import { agentView, refreshAgent } from "../state/agent";
import { JbotMessages, useJbotMessages } from "./jbot-messages";
import { SplitDashboard, SplitEmpty } from "./primitives/split";

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
  onMount(() => {
    void refreshAgent();
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void refreshAgent(); }, 10_000);
    onCleanup(() => window.clearInterval(tick));
  });

  return <SheetFill data-jbot-room="">
    {props.header(name())}
    <Show when={agentView()} fallback={<SplitEmpty>Loading…</SplitEmpty>}>
      <Show when={agentView()?.enabled} fallback={<SplitEmpty>This hub has no agent yet.</SplitEmpty>}>
        {/* No head: jbot's particulars and its page and thread are in its panel, from the composer's chip (desktop) or
            its pill (phone, jbot-status.tsx), so the messages start at the top. */}
        <SplitDashboard page="Agent" room label={`Messages with ${name()}`}
          conversation={<JbotMessages messages={log.messages()} renderer={props.markdownRenderer} name={name()} working={props.working} />}
          composer={props.composer} />
      </Show>
    </Show>
  </SheetFill>;
}
