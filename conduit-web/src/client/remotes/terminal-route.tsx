import { TerminalPane } from "./terminal-pane";
import "./terminal-route.css";

export function TerminalRoute(props: { onOpenConduit: () => void }) {
  return <main class="terminal-route">
    <TerminalPane projectId="project_chat" autoStart standaloneControls={{ onOpenConduit: props.onOpenConduit }} />
  </main>;
}
