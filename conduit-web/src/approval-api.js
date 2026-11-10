/*
 * Approvals, declared once: the answers a person can give an ask, and the kinds of permission an agent asks for, each
 * with the answers it offers. The hub builds an ask's choices from this and refuses any other (agent/policy.js
 * permissionOf, agent/asks.js); the client's card draws only what an ask offers, and its types are these
 * (agent/agent-view.d.ts). A permission that must be decided each time leaves `always` out, and no rule can be made
 * for it, by the person or by anything else.
 *
 * Plain data and small functions, no imports: the client takes it as types.
 */
export const APPROVAL_CHOICES = /** @type {const} */ ({
  allow: "This one, as the permission says how far it reaches",
  always: "From now on: a standing rule for what the ask names",
  deny: "Not this",
});

/** `choices`: the answers offered, in the order shown. `allow`: how far an Allow reaches. */
export const PERMISSIONS = /** @type {const} */ ({
  connector: { choices: ["allow", "always", "deny"], allow: "this call", says: "A connected service's action that sends, creates, changes or deletes" },
  program: { choices: ["allow", "deny"], allow: "this run", says: "A program or a held action: it cannot be read ahead of running, so no rule fits it" },
  feed: { choices: ["allow", "deny"], allow: "this change", says: "Adding a feed" },
  routine: { choices: ["allow", "deny"], allow: "this change", says: "Saving or removing a routine" },
  chat: { choices: ["allow", "always", "deny"], allow: "this message", says: "Starting a chat or posting in one of the person's" },
  device: { choices: ["allow", "always", "deny"], allow: "this call", says: "Files and commands on a device" },
  browser: { choices: ["allow", "deny"], allow: "this thread, for a day", says: "Driving the person's own signed-in browser on a device: asked of each thread, never allowed for good" },
});

/** The answers a permission offers; one not declared offers the two that need no rule. */
export const permissionChoices = (permission) => (Object.hasOwn(PERMISSIONS, String(permission)) ? [...PERMISSIONS[permission].choices] : ["allow", "deny"]);
