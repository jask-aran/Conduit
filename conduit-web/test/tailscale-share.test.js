import assert from "node:assert/strict";
import test from "node:test";
import { currentMagicDnsOrigin, magicDnsOrigin } from "../src/tailscale-share.js";

test("derives a HTTPS origin from the current node MagicDNS name", () => {
  assert.equal(magicDnsOrigin({ Self: { DNSName: "jask-desktop-wsl.tail4a8a4e.ts.net." } }), "https://jask-desktop-wsl.tail4a8a4e.ts.net");
});

test("reads the current Tailscale status through the CLI", async () => {
  const origin = await currentMagicDnsOrigin({ run: async (command, args) => {
    assert.equal(command, "tailscale");
    assert.deepEqual(args, ["status", "--json"]);
    return { stdout: JSON.stringify({ Self: { DNSName: "node.example.ts.net." } }) };
  } });
  assert.equal(origin, "https://node.example.ts.net");
});

test("rejects a status without a MagicDNS name", () => {
  assert.throws(() => magicDnsOrigin({ Self: {} }), /MagicDNS/);
});
