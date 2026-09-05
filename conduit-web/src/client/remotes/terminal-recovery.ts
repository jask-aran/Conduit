export type TerminalConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "stopped"
  | "conflict";

export type TerminalRecoveryAction = "retry" | "takeover" | "restart";

export type TerminalRecoveryView = {
  state: Exclude<TerminalConnectionState, "idle" | "connecting" | "live">;
  title: string;
  message: string;
  action: TerminalRecoveryAction | null;
};

export function terminalRecoveryView(state: TerminalConnectionState, detail = ""): TerminalRecoveryView | null {
  switch (state) {
    case "reconnecting":
      return {
        state,
        title: "Reconnecting to terminal",
        message: "The terminal connection was interrupted. Retrying automatically.",
        action: null,
      };
    case "offline":
      return {
        state,
        title: "Terminal offline",
        message: detail || "The terminal connection is offline.",
        action: "retry",
      };
    case "stopped":
      return {
        state,
        title: "Terminal stopped",
        message: "The terminal process has exited.",
        action: "restart",
      };
    case "conflict":
      return {
        state,
        title: "Terminal in use",
        message: detail || "Another Conduit client controls this terminal.",
        action: "takeover",
      };
    case "idle":
    case "connecting":
    case "live":
      return null;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}
