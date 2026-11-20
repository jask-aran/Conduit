# Email: a mail client in Conduit, synced by the hub

The mail pane, the hub's copy of Gmail and sorting by splits are built (`src/mail/`); what is left is in
`surfaces-roadmap.md`. These are the decisions the code builds toward.

- **One mail primitive, an adapter per source.** Account, thread, message, draft and label are Conduit shapes
  (`mail.d.ts`); nothing Gmail-specific reaches the browser. jbot's mailbox (`agent/email.js`) becomes a second
  account, and the same IMAP adapter later serves non-Gmail accounts.
- **IMAP and SMTP with a Gmail app password**, chosen as the least setup: no Google Cloud project, no consent screen,
  nothing that expires until revoked. The Gmail API with Conduit's own OAuth client stays a later adapter if IMAP falls
  short. Executor is too slow and too narrow for a client (about 30 s and 25 messages a run).
- **The hub keeps the copy** in SQLite and searches it with FTS5; nothing held is dropped except by "Read in again".
- **Sending.** The person sends freely. jbot sends when the person asked it to in that conversation; an email jbot
  decides to send on its own waits for approval (`agent/approval-policy.js`).
- **Sorting is Conduit's own**, in three layers: facts the hub reads in code, judgments Jev (TypeSafe) gives (one small
  question each, stored with the model version), and rules the person can read and edit that turn both into a split
  (`mail/sorting.js`, `mail/filter.js`). The model never decides the split; a judgment between 0.3 and 0.7 is unsure,
  and the message stays in the main list. Sender, subject and text may be sent to TypeSafe for every message.
- **Start minimal**: the built-in splits take the source's own sorting as it is (Gmail is trusted on marketing). A split
  is added only when the person asks or writes a rule naming one; proposals come as a short list to accept, never as
  built-in defaults.
- **Nothing is filed automatically** until the person has watched the splits for a week; then only Noise and Money.
- **Jev sorts, jbot acts**: jbot works a split on request or on a schedule, under the sending rule.
