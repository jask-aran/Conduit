import type { MailAccount, MailBody, MailChange, MailDraft, MailDraftInput, MailLabel, MailMessage, MailParty, MailThread } from "@/mail/mail";
import { api } from "../api/client";
import { httpUrl } from "../api/transport.js";
import { authorizedFetch } from "../api/native-auth-client.ts";

const q = (params: Record<string, string | number | boolean | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== false).map(([key, value]) => [key, value === true ? "1" : String(value)])).toString();
const id = encodeURIComponent;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

export const THREAD_PAGE = 50;

export const mailApi = {
  accounts: () => api<{ accounts: MailAccount[] }>("/v0/mail/accounts").then((answer) => answer.accounts),
  /** A refused sign-in rejects with the hub's sentence as the error's message. replay: false, as it carries a secret. */
  addAccount: (input: { kind: "gmail"; address: string; secret: string; name?: string }) =>
    api<{ account: MailAccount }>("/v0/mail/accounts", { ...json("POST", input), replay: false }).then((answer) => answer.account),
  removeAccount: (account: string) => api<void>(`/v0/mail/accounts/${id(account)}`, { method: "DELETE" }),
  labels: (account: string) => api<{ labels: MailLabel[] }>(`/v0/mail/accounts/${id(account)}/labels`).then((answer) => answer.labels),
  threads: (input: { account: string; label: string; before?: string | null; limit?: number }) =>
    api<{ threads: MailThread[]; next: string | null }>(`/v0/mail/threads?${q({ ...input, limit: input.limit ?? THREAD_PAGE })}`),
  thread: (thread: string) => api<{ thread: MailThread; messages: MailMessage[]; drafts: MailDraft[] }>(`/v0/mail/threads/${id(thread)}`),
  body: (message: string) => api<MailBody>(`/v0/mail/messages/${id(message)}/body`),
  change: (change: MailChange) => api<{ threads: MailThread[] }>("/v0/mail/change", json("POST", change)).then((answer) => answer.threads),
  search: (input: { account: string; q: string; remote?: boolean }) => api<{ threads: MailThread[] }>(`/v0/mail/search?${q(input)}`).then((answer) => answer.threads),
  drafts: (account: string) => api<{ drafts: MailDraft[] }>(`/v0/mail/drafts?${q({ account })}`).then((answer) => answer.drafts),
  newDraft: (input: { account: string; reply?: string; replyAll?: boolean; forward?: string; adopt?: string }) =>
    api<{ draft: MailDraft }>("/v0/mail/drafts", json("POST", input)).then((answer) => answer.draft),
  /** replay: false, as a draft keeps itself: the next edit saves it again. */
  saveDraft: (draft: string, input: MailDraftInput) => api<{ draft: MailDraft }>(`/v0/mail/drafts/${id(draft)}`, { ...json("PUT", input), replay: false }).then((answer) => answer.draft),
  removeDraft: (draft: string) => api<void>(`/v0/mail/drafts/${id(draft)}`, { method: "DELETE" }),
  sendDraft: (draft: string) => api<{ sent: true }>(`/v0/mail/drafts/${id(draft)}/send`, { method: "POST", body: "{}", timeout: false, replay: false }),
};

/** Saved as the file it is, through the sign-in an installed app carries (a plain link would go without it). */
export async function downloadAttachment(message: string, index: number, filename: string) {
  const response = await authorizedFetch(httpUrl(`/v0/mail/messages/${id(message)}/attachments/${index}`));
  if (!response.ok) throw new Error(String((await response.json().catch(() => ({})) as { message?: string }).message || "The attachment could not be read."));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url));
}

/** The hub's sentence for a failure, else the error's own. */
export const failure = (error: unknown) => error instanceof Error ? error.message : String(error);

/** "Ada <ada@x>, bob@y" to parties and back. A bare address is its own name's absence, not a guess at one. */
export const parseParties = (text: string): MailParty[] => text.split(/[,;]/).map((part) => part.trim()).filter(Boolean).map((part) => {
  const named = /^(.*?)\s*<([^>]+)>$/.exec(part);
  return named ? { name: named[1]!.replace(/^"|"$/g, "").trim(), address: named[2]!.trim() } : { name: "", address: part };
});
export const formatParties = (parties: MailParty[]) => parties.map((party) => party.name ? `${party.name} <${party.address}>` : party.address).join(", ");
