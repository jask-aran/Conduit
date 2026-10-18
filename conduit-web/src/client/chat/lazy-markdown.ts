import { lazy } from "solid-js";

/** The markdown renderer, loaded on first use so it stays out of the entry chunk. */
export const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
