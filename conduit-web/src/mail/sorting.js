/*
 * What sorting mail reads of a message beyond its fields: facts the hub reads in code (the source's own category among
 * them), and the questions a model (Jev) can be asked about it. Splits and label rules are filters (filter.js) over both.
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
