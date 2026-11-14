// The UI markup tool: mark up a running interface and send what was marked. host.ts states its boundary.
export { MarkupTool, type MarkupMode } from "./tool";
export { MarkupMargin, type MarkupMarginControl, type MarkupMarginEntry } from "./margin";
export { MARKUP_CAPABILITIES, httpTransport, NO_NAMES, type MarkupAt, type MarkupCapabilities, type MarkupDelivery, type MarkupAnchor, type MarkupOffer, type MarkupPlace, type MarkupAnswerActs, type MarkupHanded, type MarkupHost, type MarkupHostHistory, type MarkupHostTool, type MarkupMarginHost, type MarkupListener, type MarkupSend, type MarkupSent, type MarkupSuggestion, type MarkupThread, type MarkupTransport, type PieceNames } from "./host";
export { textPlace } from "./text";
