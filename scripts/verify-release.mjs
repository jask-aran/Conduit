// Checks a release archive against its minisign signature (the .sig the Tauri
// signer writes: base64 of a minisign signature file) with Node alone, so
// install.sh needs no minisign on the machine. The key is the Windows
// updater's; one key signs every artifact a release ships.
//   node verify-release.mjs <file> <file.sig> <public key, base64 as in .key.pub>
import crypto from "node:crypto";
import fs from "node:fs";

const [file, sigFile, publicKey] = process.argv.slice(2);
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
const keyLine = lines(Buffer.from(publicKey, "base64").toString())[1];
const key = Buffer.from(keyLine, "base64");
const sigText = lines(Buffer.from(fs.readFileSync(sigFile, "utf8").trim(), "base64").toString());
const signature = Buffer.from(sigText[1], "base64");
const trusted = sigText[2].replace(/^trusted comment: /, "");
const globalSignature = Buffer.from(sigText[3], "base64");

const fail = (message) => { console.error(message); process.exit(1); };
if (key.subarray(0, 2).toString() !== "Ed") fail("Unexpected public key type");
if (!signature.subarray(2, 10).equals(key.subarray(2, 10))) fail("Signed by a different key");
const ed25519 = crypto.createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10, 42)]),
  format: "der", type: "spki",
});
const algorithm = signature.subarray(0, 2).toString();
const message = algorithm === "ED"
  ? crypto.createHash("blake2b512").update(fs.readFileSync(file)).digest()
  : fs.readFileSync(file);
if (!crypto.verify(null, message, ed25519, signature.subarray(10, 74))) fail("Signature does not match");
if (!crypto.verify(null, Buffer.concat([signature.subarray(10, 74), Buffer.from(trusted)]), ed25519, globalSignature)) {
  fail("Trusted comment does not match");
}
