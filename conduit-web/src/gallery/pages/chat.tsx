import { ChatEmpty, ChatScroller, ChatView, ComposerDock, ComposerField, DesktopComposer, Header, HeaderCrumb, Sheet, TextArea, Toolbar, Welcome } from "@/components/ui";
import { row, token, type Page } from "../model";
import { conversation } from "./transcript";
import { send, toolbarEnd, toolbarStart } from "./desktop-composer";

/* A chat in the main pane at a fraction of the window's height (a sheet's height is the window's). */
const composer = () => <DesktopComposer><ComposerField><TextArea placeholder="Send a message…" /></ComposerField><Toolbar start={toolbarStart()} end={toolbarEnd()} primary={send()} /></DesktopComposer>;
const scene = (opts: { empty?: boolean } = {}) => <div class="g-shell" style={{ height: "calc(36 * var(--u-space) + var(--space-xl))" }}>
  <Sheet as="main" lead style={{ height: "calc(36 * var(--u-space))" }}>
    <Header><HeaderCrumb place="Japan" title={opts.empty ? "New chat" : "Lorem ipsum file"} /></Header>
    <ChatView empty={opts.empty}>
      <ChatScroller>{opts.empty ? <ChatEmpty><Welcome title="How can I help you today?" /></ChatEmpty> : conversation()}</ChatScroller>
      <ComposerDock>{composer()}</ComposerDock>
    </ChatView>
  </Sheet>
</div>;

export const chatPage: Page = {
  title: "Chat", rail: "Blocks",
  summary: "A chat in its pane: the transcript scrolling under the pane's header (it takes the header's height back, so text runs to the top edge under the gradient), in the reading column, with the composer docked over its foot. Empty, the composer sits centred under the welcome; on a phone at the foot.",
  preview: () => scene(),
  usage: `import { ChatView, ChatScroller, ChatEmpty, ComposerDock, Welcome } from "@/components/ui";

<ChatView empty={empty()} sending={sending()} opening={opening()}>
  <ChatScroller ref={…} motionRef={…} viewportRef={…} over={<RiderButton …/>}>
    <Show when={empty()}><ChatEmpty><Welcome title="How can I help you today?" /></ChatEmpty></Show>
    <Transcript>…</Transcript>
  </ChatScroller>
  <ComposerDock>{composer}</ComposerDock>
</ChatView>`,
  anatomy: { scene: () => scene(), parts: [
    { selector: ".ui-chat-scroller", name: "Scroller", does: "scrolls under the header; the panel motion moves its shell", from: "ChatScroller" },
    { selector: ".ui-chat-column", name: "Reading column", does: "the column's width preset; its foot clears the composer", from: "ChatScroller" },
    { selector: ".ui-composer-dock", name: "Dock", does: "the composer over the transcript's foot; only it takes the pointer", from: "ComposerDock" },
  ] },
  examples: [
    row("chat", "a conversation, the composer docked over its foot", () => scene(), { surfaces: ["ground"], source: "chat/chat-screen.tsx" }),
    row("empty", "nothing said yet: the composer centred under the welcome", () => scene({ empty: true }), { surfaces: ["ground"], code: "<ChatView empty>", source: "main.tsx" }),
  ],
  tokens: [{ title: "The reading column", tokens: [
    token("--transcript-column-width", "the column's width (the reader's preset; the reading width by default)"),
    token("--transcript-column-gutter", "the room it keeps from the pane's edges"),
    token("--transcript-wide-scale", "how far a table may bleed past it in a wide chat"),
    token("--transcript-code-bleed", "code's bleed, when the reader asks for wide code (unset: none)"),
    token("--transcript-composer-inset", "the dock's height, measured by the app, cleared at the column's foot"),
    token("--font-transcript", "the column's face"),
  ] }],
  api: ["ChatView", "ChatScroller", "ChatEmpty", "ComposerDock"],
};
