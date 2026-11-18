/*
 * Sorting mail. Facts: what the hub reads from a message in code (the source's own category among them). Rules: data the
 * person and agents read and write, tried in order, the first whose condition holds giving the category. A condition is
 * about facts, words in a field, or a judgment asked of a model (Jev, every question's words here); a judgment nobody has
 * given settles nothing, so a rule that needs one does not hold. The model never names a category.
 */
export const JEV_MODEL = "jev-latest";
export const YES = 0.7, NO = 0.3;
const TEXT_SHOWN = 6000;

/** Each a statement Jev gives the chance of (a Noul); `urgency` a Score. The ids are the judgment's names in the rules. */
export const QUESTIONS = {
  personal: { type: "noul", instructions: "Did a person write `message.text` themselves, to `message.to_you` in particular?",
    criteria: { true: "One person wrote it by hand for this reader: a colleague, a friend, a clinic's receptionist answering a question.", false: "A system or a mailing sent it: a notification, a receipt, a newsletter, an offer sent to many people." } },
  asks_reply: { type: "noul", instructions: "Does `message.text` ask the reader a question or ask them to write back?",
    criteria: { true: "The sender is waiting for an answer from the reader.", false: "Nothing in it needs an answer; it only informs or offers." } },
  asks_action: { type: "noul", instructions: "Does `message.text` require the reader to do something other than reply, such as pay, sign, confirm, book or send a document?",
    criteria: { true: "Something goes wrong or stays undone for the reader unless they act.", false: "The reader can ignore it at no cost: it informs, or invites them to buy or read something." } },
  deadline: { type: "noul", instructions: "Does `message.text` give a date or time by which the reader must act?",
    criteria: { true: "A bill's due date, a form's closing date, a reply needed by Friday.", false: "No date binds the reader: none is given, or it is only when a sale ends or an event is on." } },
  receipt: { type: "noul", instructions: "Is `message.text` a record of money paid or owed: a receipt, an invoice, an order confirmation, a statement or a refund?",
    criteria: { true: "It records a payment, a charge, an order placed or an amount due.", false: "No payment or charge by the reader is recorded; prices in an offer do not count." } },
  logistics: { type: "noul", instructions: "Is `message.text` about a delivery, a booking, a reservation or an appointment of the reader's?",
    criteria: { true: "A parcel on its way, a flight or room booked, an appointment set or a reminder of one.", false: "It concerns no delivery, booking or appointment the reader already has." } },
  security: { type: "noul", instructions: "Is `message.text` an alert about the security of one of the reader's accounts?",
    criteria: { true: "A new sign-in, a password or verification code, a changed setting, a suspected breach.", false: "It is not about access to an account." } },
  marketing: { type: "noul", instructions: "Is `message.text` trying to get the reader to buy, upgrade, subscribe or attend something?",
    criteria: { true: "A sale, an offer, a product launch, an invitation to an event meant to sell.", false: "It does not promote anything." } },
  newsletter: { type: "noul", instructions: "Is `message.text` an issue of a newsletter or digest meant to be read for its articles?",
    criteria: { true: "Written pieces, news or links to read, sent on a schedule to subscribers.", false: "It is not an issue of a publication; an offer or a notification does not count." } },
  urgency: { type: "score", instructions: "How soon does `message.text` matter to the reader?",
    criteria: ["It never needs the reader's attention.", "It can be read whenever the reader likes.", "It needs the reader's attention within the week.", "It needs the reader's attention today."] },
};

/** What Jev is shown of a message: what a person sorting it would look at, and nothing else. */
export const stateOf = (message, facts) => ({ message: {
  from: message.from.name ? `${message.from.name} <${message.from.address}>` : message.from.address,
  to_you: facts.direct ? "addressed to the reader alone" : facts.listed ? "sent through a mailing list" : "sent to the reader among others",
  subject: message.subject, text: message.text.slice(0, TEXT_SHOWN),
} });

// What a subject or the start of a text says of its kind, read by pattern: a guess the rules weigh with the rest, never alone against the source's sorting.
const KINDS = {
  security: /\b(verification code|security (alert|code|notice)|one[- ]time (code|pass(word|code))|new (sign|log)[- ]?in|sign[- ]?in (attempt|code|from)|new device|password (reset|was changed|changed)|reset your password|2[- ]step|two[- ]factor|confirm your (email|account)|verify your (email|account|identity)|unusual activity)\b/i,
  receipt: /\b(receipt|tax invoice|invoice|order (confirm\w*|number|#|placed|summary)|ordered:|your order|payment (received|confirm\w*|successful|processed|due)|statement (is )?(ready|available)|refund(ed)?|amount (paid|due)|thanks? for your (order|purchase|payment)|direct debit|bill (is )?(ready|due))\b/i,
  logistics: /\b(shipped|dispatched|delivered|out for delivery|delivery|parcel|package|tracking|on its way|booking|reservation|itinerary|appointment|check[- ]?in|boarding pass|e-?ticket|your (trip|stay|flight))\b/i,
  action: /\b(action required|response required|please (confirm|complete|sign|verify|review|respond|reply|provide|update)|overdue|final (notice|reminder)|expir(es|ing|ed)|due (on|by|date)|rsvp)\b/i,
  bulk: /\b(unsubscribe|view (this email |it )?in (your |a )?browser|manage (your )?(email )?preferences|email preferences|you(.re| are) receiving this (email|message))\b/i,
};
const ROBOT = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|notify|mailer|mailing|news(letter)?|updates?|alerts?|info|hello|hi|team|support|service|billing|orders?|accounts?|marketing|promo(tions)?|digest|bounce\w*)([._+-]|@)/;

/**
 * What code knows of a message (its `date` in ms). `own`: the account's address; `wroteTo(address)`: the person has sent
 * mail to it; `last`: it is its thread's newest.
 */
export function factsOf(message, { own, wroteTo, last = true, now = Date.now() }) {
  const address = message.from.address.toLowerCase(), to = message.to.map((party) => party.address.toLowerCase());
  const head = `${message.subject}\n${message.text.slice(0, 1500)}`;
  const robot = ROBOT.test(address), bulk = KINDS.bulk.test(message.text);
  // A subject that says a kind settles it; only a subject that says none leaves it to the start of the text, and a mailing's text never says there is something to do.
  const named = ["security", "receipt", "logistics", "action"].filter((name) => KINDS[name].test(message.subject));
  const kind = (name) => named.length ? named.includes(name) : !(bulk && name === "action") && KINDS[name].test(head);
  const source = message.category ?? null;
  return {
    address, mine: address === own, last,
    direct: to.length === 1 && to[0] === own, listed: !to.includes(own) && !message.cc.some((party) => party.address.toLowerCase() === own),
    known: wroteTo(address), robot, bulk, person: !robot && !bulk && source !== "promotions" && source !== "social",
    asks: /\?(\s|$)/.test(message.text.slice(0, 3000)),
    security: kind("security"), receipt: kind("receipt"), logistics: kind("logistics"), action: kind("action"),
    attachments: message.attachments, important: message.labels.includes("important"), source,
    age: Math.floor((now - message.date) / 86_400_000),
  };
}

/** Jev's answers to QUESTIONS about one message, as numbers: a Noul's chance, the Score's level probabilities' mean. Throws on a failed call: no answer is never an answer. */
export async function judge(message, facts, { key, fetch: ask = fetch, tries = 4 }) {
  const body = JSON.stringify({ model: JEV_MODEL, state: stateOf(message, facts), questions: QUESTIONS });
  for (let attempt = 1; ; attempt++) {
    const answer = await ask("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body });
    if (answer.ok) {
      const read = await answer.json();
      return { model: read.model, tokens: read.usage?.input_tokens ?? 0,
        answers: Object.fromEntries(Object.entries(read.answers).map(([id, one]) => [id, one.type === "noul" ? one.noul : one.score])) };
    }
    if (![429, 529].includes(answer.status) || attempt === tries) throw new Error(`TypeSafe answered ${answer.status}: ${(await answer.text()).slice(0, 300)}`);
    await new Promise((resolve) => setTimeout(resolve, (Number(answer.headers.get("retry-after")) || 2 ** attempt) * 1000));
  }
}

/** The categories every account has, in the order a list offers them; a rule may name one of its own (`then.name`). */
export const CATEGORIES = [["reply", "Reply"], ["todo", "To do"], ["waiting", "Waiting"], ["alerts", "Alerts"], ["money", "Money"], ["logistics", "Trips & deliveries"], ["reading", "Reading"], ["noise", "Noise"], ["other", "Other"]]
  .map(([id, name]) => ({ id, name }));
export const categoryId = (name) => CATEGORIES.find((one) => one.id === name || one.name.toLowerCase() === String(name).toLowerCase())?.id
  ?? String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/*
 * A condition (MailCondition in mail.d.ts):
 *   { all: [c…] } { any: [c…] } { not: c }
 *   { fact: name }                      a fact that is true        { fact: "source", is: "promotions" }   a fact's value
 *   { fact: "age", under: 14 }          a number under a bound
 *   { field: "from" | "to" | "subject" | "text", has: "words" }    the words are in it, whatever their case; `from`/`to` take an address or "@domain"
 *   { ask: question id, atLeast?: 0.7 } Jev's chance for one of QUESTIONS; not given, the condition does not hold
 */
const person = { all: [{ fact: "person" }, { any: [{ fact: "known" }, { fact: "source", is: "primary" }, { fact: "source", is: null }] }] };
const sold = { fact: "source", is: "promotions" };
/** What every account starts with, tried after the person's and agents' own; each can be turned off (`on: false` saved under its id). */
export const BUILT_IN = [
  { id: "waiting", name: "I wrote last", when: { all: [{ fact: "mine" }, { fact: "last" }, { fact: "age", under: 14 }] }, then: { category: "waiting" } },
  { id: "own", name: "My own messages", when: { fact: "mine" }, then: { category: "other" } },
  { id: "alerts", name: "Security alerts", when: { all: [{ fact: "security" }, { not: person }, { not: sold }] }, then: { category: "alerts" } },
  { id: "reply", name: "A person is waiting for an answer", when: { all: [person, { fact: "last" }, { any: [{ fact: "asks" }, { fact: "known" }] }] }, then: { category: "reply" } },
  { id: "todo", name: "Something to do", when: { all: [{ fact: "action" }, { not: sold }] }, then: { category: "todo" } },
  { id: "money", name: "Receipts and invoices", when: { all: [{ fact: "receipt" }, { not: sold }] }, then: { category: "money" } },
  { id: "logistics", name: "Deliveries, bookings and appointments", when: { all: [{ fact: "logistics" }, { not: sold }] }, then: { category: "logistics" } },
  { id: "noise", name: "What the source calls promotions", when: sold, then: { category: "noise" } },
  { id: "reading", name: "Mailings to read", when: { all: [{ fact: "bulk" }, { not: person }] }, then: { category: "reading" } },
].map((rule) => ({ ...rule, by: "conduit", on: true }));

const FIELDS = { from: (message) => `${message.from.name} <${message.from.address}>`, to: (message) => [...message.to, ...message.cc].map((party) => party.address).join(" "), subject: (message) => message.subject, text: (message) => message.text };
const FACTS = ["mine", "last", "direct", "listed", "known", "robot", "bulk", "person", "asks", "security", "receipt", "logistics", "action", "attachments", "important", "source", "age"];
/** Why a condition cannot be kept, or "" for one that can. */
export function conditionFault(when, depth = 0) {
  if (!when || typeof when !== "object" || Array.isArray(when) || depth > 8) return "A condition is an object, nested no deeper than 8.";
  for (const key of ["all", "any"]) if (key in when) return Array.isArray(when[key]) && when[key].length && when[key].length <= 32 ? when[key].map((one) => conditionFault(one, depth + 1)).find(Boolean) ?? "" : `"${key}" takes 1 to 32 conditions.`;
  if ("not" in when) return conditionFault(when.not, depth + 1);
  if ("fact" in when) return FACTS.includes(when.fact) ? "" : `No such fact: ${when.fact}. The facts are ${FACTS.join(", ")}.`;
  if ("field" in when) return when.field in FIELDS && typeof when.has === "string" && when.has.trim() && when.has.length <= 200 ? "" : `"field" is one of ${Object.keys(FIELDS).join(", ")} with "has" words (200 characters at most).`;
  if ("ask" in when) return when.ask in QUESTIONS ? "" : `No such question: ${when.ask}. The questions are ${Object.keys(QUESTIONS).join(", ")}.`;
  return "A condition is one of all, any, not, fact, field or ask.";
}
/** Whether a condition holds of a message, its facts and the judgments given of it. */
export function holds(when, message, facts, answers = {}) {
  if ("all" in when) return when.all.every((one) => holds(one, message, facts, answers));
  if ("any" in when) return when.any.some((one) => holds(one, message, facts, answers));
  if ("not" in when) return !holds(when.not, message, facts, answers);
  if ("fact" in when) return "under" in when ? facts[when.fact] < when.under : "is" in when ? facts[when.fact] === when.is : Boolean(facts[when.fact]);
  if ("field" in when) return FIELDS[when.field](message).toLowerCase().includes(when.has.trim().toLowerCase());
  if ("ask" in when) return answers[when.ask] >= (when.atLeast ?? YES);
  return false;
}
/** The category the first rule that holds gives, and that rule's id; "other" where none does. */
export function sortOf(rules, message, facts, answers = {}) {
  const rule = rules.find((one) => one.on !== false && holds(one.when, message, facts, answers));
  return { category: rule ? categoryId(rule.then.category) : "other", rule: rule?.id ?? null };
}
