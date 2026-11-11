import { SheetFill } from "@/components/ui";
import type { Accessor } from "solid-js";
import { TerminalPane } from "../remotes/terminal-pane";
import type { Connectivity } from "../state/runtime";
import "./workspace.css";

export function TerminalView(props: {
  computer: boolean;
  projectId: string;
  projectName: string;
  workingRoot: string;
  terminalId?: string;
  focusRequest: number;
  connectivity?: Accessor<Connectivity>;
  onOpenBeside?: (terminalId: string) => void;
}) {
  return <SheetFill>
    <TerminalPane projectId={props.computer ? "computer" : props.projectId} projectName={props.computer ? "Computer" : props.projectName} workingRoot={props.computer ? props.workingRoot : undefined} terminalId={props.terminalId} focusRequest={props.focusRequest} connectivity={props.connectivity} onOpenBeside={props.onOpenBeside} />
  </SheetFill>;
}
