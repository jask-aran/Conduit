import assert from "node:assert/strict";
import test from "node:test";
import {
  announcedAttachmentIds,
  attachmentChatIdFromPath,
  parseAttachmentEnvelope,
  serializeAttachmentEnvelope,
} from "../src/attachment-envelope.js";

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
  assert.equal(parsed.attachments[0].chatId, "550e8400-e29b-41d4-a716-446655440099");
  assert.equal(parsed.attachments[0].type, "text/plain");
  assert.deepEqual([...announcedAttachmentIds([{ type: "message", message: { role: "user", content: encoded } }])], [attachment.id]);
});

test("attachmentChatIdFromPath extracts the owning chat from envelope paths", () => {
  assert.equal(
    attachmentChatIdFromPath(".conduit/chats/1ca365d0-6c30-4fcd-8150-56f64325b079/attachments/a.png"),
    "1ca365d0-6c30-4fcd-8150-56f64325b079",
  );
  assert.equal(attachmentChatIdFromPath("relative/nope.png"), null);
});

test("ordinary user text is not mistaken for an attachment envelope", () => {
  assert.deepEqual(parseAttachmentEnvelope("<conduit_attachments>not valid"), {
    message: "<conduit_attachments>not valid",
    attachments: [],
  });
});
