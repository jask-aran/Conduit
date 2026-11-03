---
title: Email
trigger: { every: 30 }
enabled: false
tasks:
  - id: items
    kind: executor
    code: |
      // New inbox mail, every Gmail account connected in Executor (Executor names them in its action signatures; none
      // connected is an error the page shows). Inbox mail from the last two days, newest 50 an account (not promotions
      // or social); each message the feed has not seen (seen, handed in by the hub) is fetched whole, up to 25 a check
      // across accounts (the rest come next check); its HTML part (or plain) goes back still encoded, and the hub
      // decodes it (decoding here is slow).
      const found = await tools.search({ query: "gmail users messages list", limit: 10 });
      const lister = (found.items ?? []).find((item) => item.path === "tools.gmail.api.users.gmailUsersMessagesList");
      const accounts = [...new Set(String(lister?.input ?? "").split('"').filter((part) => part.startsWith("acc_")))];
      if (!accounts.length) throw new Error("No Gmail account is connected in Executor: connect one there, then this runs.");
      const one = accounts.length === 1;
      const listed = await Promise.all(accounts.map(async (accountId) => {
        const list = await tools.gmail.api.users.gmailUsersMessagesList({ accountId, input: { path: { userId: "me" },
          query: { q: "in:inbox newer_than:2d -category:promotions -category:social", maxResults: 50 } } });
        return (list.messages ?? []).map((message) => ({ accountId, id: one ? message.id : accountId + ":" + message.id, gmailId: message.id }));
      }));
      const fresh = listed.flat().filter((message) => !seen.has(message.id)).slice(0, 25);
      const fulls = await Promise.all(fresh.map((message) =>
        tools.gmail.api.users.gmailUsersMessagesGet({ accountId: message.accountId, input: { path: { userId: "me", id: message.gmailId }, query: { format: "full" } } })
          .then((full) => ({ message, full }))));
      const parts = (part) => part ? [part, ...(part.parts ?? []).flatMap(parts)] : [];
      return fulls.map(({ message, full }) => {
        const header = (name) => full.payload?.headers?.find((item) => item.name === name)?.value ?? "";
        const all = parts(full.payload).filter((part) => part.body?.data);
        const part = all.find((item) => item.mimeType === "text/html") ?? all.find((item) => item.mimeType === "text/plain");
        const labels = (full.labelIds ?? []).filter((label) => /^CATEGORY_|^IMPORTANT$|^STARRED$/.test(label)).map((label) => label.replace(/^CATEGORY_/, "").toLowerCase());
        return { id: message.id, title: header("Subject") || "(no subject)",
          detail: [header("From").replace(/\s*<.*>$/, "").replace(/^"|"$/g, ""), labels.length ? "(" + labels.join(", ") + ")" : ""].filter(Boolean).join(" "),
          text: full.snippet ?? "", encoded: part ? { data: part.body.data, mimeType: part.mimeType } : undefined,
          at: new Date(Number(full.internalDate)).toISOString(), url: "https://mail.google.com/mail/u/0/#all/" + full.id,
          level: full.labelIds?.includes("IMPORTANT") ? "attention" : "fyi" };
      });
gate: never
output: inbox
quiet: false
---
