import { createSignal } from "solid-js";

/** What the first open waits for beyond its route: the agent's messages read and the markdown renderer loaded. */
export const [agentPageLaidOut, setAgentPageLaidOut] = createSignal(false);
/** The dashboard has no message log or home-thread composer to wait for. */
export const [agentDashboardLaidOut, setAgentDashboardLaidOut] = createSignal(false);
