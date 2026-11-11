import { defineDoc } from "@earendil-works/pi-durable";

/** One Session document, so what it holds commits with the work that changes it and survives a restart with it. */
export const AgentDoc = defineDoc({
  checkpointWhen: () => false, kind: "conduit.agent",
  version: 1,
  scope: "session",
  initial: () => ({ home: null, schedules: {}, watches: {}, hooks: {}, proposals: {}, spend: {}, notices: [], tainted: {}, readOutside: {}, rules: {}, approvalPolicy: null, asks: {}, inbox: {}, next: 1 }),
});

/** Call inside the commit that stores it. */
export const nextId = (doc, prefix) => `${prefix}-${doc.next++}`;
