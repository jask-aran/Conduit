import { createSignal } from "solid-js";

/**
 * What the first open waits for beyond its route (main.tsx's arrival: laid out, then faded in once). The agent's
 * page: its messages read and the markdown renderer that draws them loaded (dashboard/jbot-messages.tsx sets it).
 */
export const [agentPageLaidOut, setAgentPageLaidOut] = createSignal(false);
