// The UI feedback tool: mark up a running interface and send what was marked. host.ts states its boundary.
export { FeedbackTool, type FeedbackMode } from "./tool";
export { httpTransport, NO_NAMES, type FeedbackHanded, type FeedbackHost, type FeedbackListener, type FeedbackSend, type FeedbackTransport, type PieceNames } from "./host";
