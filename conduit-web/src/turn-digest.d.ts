import type { ToolFacts, ToolKind } from "./client/api/contracts";
export type DigestStep = { name?: string; kind?: ToolKind; subject?: string; facts?: ToolFacts; input?: unknown; spawn?: boolean; agent?: { id: string | null } | null };
export type Act = { verb: [string, string]; object: string; many?: string; rank: number; failed?: boolean };
export type CountedAct = Act & { count: number; at: number };
export function actOf(step: DigestStep, failed?: boolean, own?: boolean): Act | null;
export function digestActs(steps: { step: DigestStep; failed: boolean }[], own?: boolean): CountedAct[];
export function digestLine(acts: CountedAct[]): string;
export function doingOf(step: DigestStep, own?: boolean): string;
