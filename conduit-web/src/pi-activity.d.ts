import type { HostUiRequest } from "./client/api/contracts";

export function applyActivityEvent(record: unknown, event: unknown): boolean;
export function isBlockingHostUi(event: unknown): boolean;
export function normalizeHostUiRequest(event: unknown): HostUiRequest | null;
