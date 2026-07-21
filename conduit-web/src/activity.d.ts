import type { HostUiRequest, RetryState } from "./client/api/contracts";

export interface FineActivityInput {
  generation?: string;
  processStatus?: string;
  coarse?: string;
  thinking?: boolean;
  responding?: boolean;
  toolName?: string | null;
  retry?: RetryState | null;
}

export function deriveFineActivity(input?: FineActivityInput): { kind: string; label: string | null };
export function normalizeHostUiRequest(event: unknown): HostUiRequest | null;
