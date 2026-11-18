/*
 * Sorting mail, in three layers. Facts: what the hub reads from a message in code. Judgments: what Jev (TypeSafe) says of
 * it, each one small question, every question's words here. Rules: code that turns the two into a category; the model
 * never names one. A judgment between UNSURE's bounds settles nothing, and a message nothing settles is "other".
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

/** What code knows of a message. `wroteTo(address)`: the person has sent mail to it. */
export function factsOf(message, { own, wroteTo }) {
  const address = message.from.address.toLowerCase(), to = message.to.map((party) => party.address.toLowerCase());
  return {
    mine: address === own, direct: to.length === 1 && to[0] === own, listed: !to.includes(own) && !message.cc.some((party) => party.address.toLowerCase() === own),
    known: wroteTo(address), robot: /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer|news(letter)?|updates?|info|hello|team|support)@/.test(address),
    attachments: message.attachments, important: message.labels.includes("important"), source: message.category ?? null,
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

/** The categories, in the order the rules try them. */
export const CATEGORIES = ["alerts", "reply", "todo", "money", "logistics", "reading", "noise", "other"];
/** The category the rules give, and which rule gave it. The source's own sorting is trusted on marketing. */
export function categorise(facts, a) {
  const yes = (id) => a[id] >= YES, no = (id) => a[id] <= NO;
  const promo = facts.source === "promotions";
  const sold = yes("marketing") || (promo && !no("marketing"));
  if (facts.mine) return ["other", "the person's own message"];
  if (yes("security") && !sold) return ["alerts", "a security alert"];
  if (yes("personal") && yes("asks_reply")) return ["reply", "a person asks for an answer"];
  if (facts.known && !facts.robot && yes("asks_reply")) return ["reply", "someone the person writes to asks for an answer"];
  if (!sold && (yes("asks_action") || yes("deadline"))) return ["todo", yes("deadline") ? "something to do by a date" : "something to do"];
  if (yes("receipt") && !sold) return ["money", "a record of money"];
  if (yes("logistics") && !sold) return ["logistics", "a delivery, booking or appointment"];
  if (yes("newsletter") && !yes("marketing")) return ["reading", "a newsletter"];
  if (sold) return ["noise", promo ? "marketing, and the source says promotions" : "marketing"];
  if (yes("personal")) return ["other", "from a person, asking nothing"];
  return ["other", "nothing settled it"];
}
