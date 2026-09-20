import type { RetryState } from "./client/api/contracts";

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
export function activityLabel(activity: string, detail?: string | null): string;
