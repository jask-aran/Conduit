import type { Accessor } from "solid-js";
import { TerminalPane } from "../remotes/terminal-pane";
import type { Connectivity } from "../state/runtime";
import "./workspace.css";

/**
 * A place's shells. On the Computer page the terminal belongs to the machine,
 * rooted at the folder being browsed, rather than to a project.
 */
export function TerminalView(props: {
  computer: boolean;
  projectId: string;
  projectName: string;
  workingRoot: string;
  terminalId?: string;
  focusRequest: number;
  connectivity?: Accessor<Connectivity>;
  /** Open one of the place's terminals in the other side of the main pane. */
  onOpenBeside?: (terminalId: string) => void;
}) {
  return <section class="workspace-terminal-slot">
    <TerminalPane projectId={props.computer ? "computer" : props.projectId} projectName={props.computer ? "Computer" : props.projectName} workingRoot={props.computer ? props.workingRoot : undefined} terminalId={props.terminalId} focusRequest={props.focusRequest} connectivity={props.connectivity} onOpenBeside={props.onOpenBeside} />
  </section>;
}
