const MAX_FIELD_LENGTH = 600;
const MAX_PROMPT_LENGTH = 12_000;
const SECRET_ASSIGNMENT = /((?:["']?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|authorization|cookie|credential)["']?)\s*[:=]\s*["']?)([^"',\s;}\]]+)/gi;

export interface ErrorDiagnosticContext {
  route?: string;
  chat?: { id?: string | null; projectId?: string | null; status?: string | null };
  runtime?: {
    kind?: string | null;
    installationId?: string | null;
    binaryVersion?: string | null;
    profileId?: string | null;
    profileVersion?: string | null;
  };
  model?: string | null;
  thinkingLevel?: string | null;
  connectivity?: string | null;
}

export interface ErrorDiagnostic {
  timestamp: string;
  message: string;
  name?: string;
  code?: string;
  type?: string;
  status?: number;
  method?: string;
  path?: string;
  route?: string;
  chat?: { id?: string; projectId?: string; status?: string };
  runtime?: {
    kind?: string;
    installationId?: string;
    binaryVersion?: string;
    profileId?: string;
    profileVersion?: string;
  };
  model?: string;
  thinkingLevel?: string;
  connectivity?: string;
}

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};

export function safeDiagnosticText(value: unknown, limit = MAX_FIELD_LENGTH): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(SECRET_ASSIGNMENT, "$1[redacted]")
    .trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function optionalText(value: unknown): string | undefined {
  const text = safeDiagnosticText(value);
  return text || undefined;
}

function optionalRecord(values: Record<string, unknown>): Record<string, string> | undefined {
  const entries = Object.entries(values)
    .map(([key, value]) => [key, optionalText(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function createErrorDiagnostic(error: unknown, context: ErrorDiagnosticContext = {}): ErrorDiagnostic {
  const source = record(error);
  const request = record(source.apiRequest);
  const runtimeEvent = record(source.runtimeEvent);
  const message = safeDiagnosticText(error instanceof Error ? error.message : source.message || error || "Request failed") || "Request failed";
  const status = Number(request.status || source.status);
  const diagnostic: ErrorDiagnostic = {
    timestamp: new Date().toISOString(),
    message,
    ...optionalRecord({
      name: error instanceof Error ? error.name : source.name,
      code: source.code || source.error,
      type: runtimeEvent.type || source.type,
      method: request.method,
      path: request.path,
      route: context.route,
      model: context.model,
      thinkingLevel: context.thinkingLevel,
      connectivity: context.connectivity,
    }),
    ...(Number.isFinite(status) && status > 0 ? { status } : {}),
  };
  const chat = optionalRecord({
    id: context.chat?.id,
    projectId: context.chat?.projectId,
    status: context.chat?.status,
  });
  if (chat) diagnostic.chat = chat;
  const runtime = optionalRecord({
    kind: context.runtime?.kind,
    installationId: context.runtime?.installationId,
    binaryVersion: context.runtime?.binaryVersion,
    profileId: context.runtime?.profileId,
    profileVersion: context.runtime?.profileVersion,
  });
  if (runtime) diagnostic.runtime = runtime;
  return diagnostic;
}

export function formatRuntimeDiagnosticPrompt(diagnostic: ErrorDiagnostic): string {
  const prefix = "The following is a bounded, redacted Conduit error report. Explain what failed, what evidence supports the diagnosis, and the smallest safe recovery step.\n\nConduit error report:\n```json\n";
  const suffix = "\n```";
  let payload = JSON.stringify(diagnostic, null, 2);
  if (prefix.length + payload.length + suffix.length > MAX_PROMPT_LENGTH) {
    payload = JSON.stringify({ ...diagnostic, message: safeDiagnosticText(diagnostic.message, 240), note: "Diagnostic fields were bounded before transmission." }, null, 2);
  }
  const prompt = `${prefix}${payload}${suffix}`;
  return prompt.length > MAX_PROMPT_LENGTH ? `${prompt.slice(0, MAX_PROMPT_LENGTH - 1)}…` : prompt;
}

export const ERROR_DIAGNOSTIC_LIMITS = { maxFieldLength: MAX_FIELD_LENGTH, maxPromptLength: MAX_PROMPT_LENGTH } as const;
