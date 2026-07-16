import assert from "node:assert/strict";
import test from "node:test";
import { announcedAttachmentIds, parseAttachmentEnvelope, serializeAttachmentEnvelope } from "../src/attachment-envelope.js";

test("attachment envelopes round-trip Unicode and escaped XML safely", () => {
  const attachment = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: 'résumé & "notes".txt',
    storedName: '550e8400-e29b-41d4-a716-446655440000--résumé & "notes".txt',
  };
  const encoded = serializeAttachmentEnvelope({
    chatId: "550e8400-e29b-41d4-a716-446655440099",
    attachments: [attachment],
    message: "Read <this> & explain it.",
  });
  const parsed = parseAttachmentEnvelope(encoded);
  assert.equal(parsed.message, "Read <this> & explain it.");
  assert.equal(parsed.attachments[0].name, attachment.name);
  assert.deepEqual([...announcedAttachmentIds([{ type: "message", message: { role: "user", content: encoded } }])], [attachment.id]);
});

test("ordinary user text is not mistaken for an attachment envelope", () => {
  assert.deepEqual(parseAttachmentEnvelope("<conduit_attachments>not valid"), {
    message: "<conduit_attachments>not valid",
    attachments: [],
  });
});
