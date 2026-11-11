import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writePrivateJson } from "./private-file.js";

/*
 * A self-signed leaf whose key the identity attests, so a relay that forwards `prove()` nonces cannot complete a
 * handshake. Two keys: the identity stays Ed25519 (changing it would unpair every client), the leaf is ECDSA P-256
 * because Chromium will not accept an Ed25519 certificate and both shells are Chromium.
 * Built here rather than by a library: nothing chains to it, and a dependency in the trust path is a worse trade.
 */

// Domain separation, so an attestation cannot be replayed as another signature.
const ATTESTATION_PREFIX = "conduit-leaf-spki-sha256.v1";

const CURVE = "prime256v1";

function length(size) {
  if (size < 0x80) return Buffer.from([size]);
  const bytes = [];
  for (let value = size; value > 0; value = Math.floor(value / 256)) bytes.unshift(value % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tagged(tag, body) {
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

const sequence = (...parts) => tagged(0x30, Buffer.concat(parts));
const set = (...parts) => tagged(0x31, Buffer.concat(parts));

// Padded so the top bit never reads as a sign.
function integer(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0 && (bytes[start + 1] & 0x80) === 0) start += 1;
  const trimmed = bytes.subarray(start);
  return tagged(0x02, (trimmed[0] & 0x80) === 0 ? trimmed : Buffer.concat([Buffer.from([0]), trimmed]));
}

// BigInt because a `2.25` arc carries a whole UUID as one 128-bit arc.
function oid(dotted) {
  const parts = dotted.split(".").map(BigInt);
  const bytes = [Number(parts[0] * 40n + parts[1])];
  for (const part of parts.slice(2)) {
    const chunk = [Number(part & 0x7fn)];
    for (let rest = part >> 7n; rest > 0n; rest >>= 7n) chunk.unshift(Number(rest & 0x7fn) | 0x80);
    bytes.push(...chunk);
  }
  return tagged(0x06, Buffer.from(bytes));
}

const bitString = (body) => tagged(0x03, Buffer.concat([Buffer.from([0]), body]));
const octetString = (body) => tagged(0x04, body);
const utf8String = (text) => tagged(0x0c, Buffer.from(text, "utf8"));
const boolTrue = Buffer.from([0x01, 0x01, 0xff]);
const explicit = (index, body) => tagged(0xa0 | index, body);

// UTCTime is what a certificate expiring before 2050 is written in.
function utcTime(date) {
  const iso = new Date(date).toISOString();
  return tagged(0x17, Buffer.from(`${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`, "utf8"));
}

const OIDS = {
  commonName: "2.5.4.3",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  subjectAltName: "2.5.29.17",
  serverAuth: "1.3.6.1.5.5.7.3.1",
};

/*
 * The `2.25` arc takes a UUID and needs no registration. Non-critical, so a TLS stack that does not know it ignores it.
 * Carried in the certificate so a shell can decide mid-handshake: a pin on the leaf's own hash would need every
 * re-issued leaf's attestation delivered over some other route first.
 */
const ATTESTATION_EXTENSION_OID = "2.25.3346790509059223890722535119545092606";

function extension(id, critical, value) {
  return sequence(oid(id), ...(critical ? [boolTrue] : []), octetString(value));
}

// An IPv4 literal goes in as `iPAddress`: a `dNSName` holding the same digits is not consulted for an address.
function generalName(host) {
  const parts = host.split(".");
  const octets = parts.length === 4 ? parts.map(Number) : null;
  if (octets && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return tagged(0x87, Buffer.from(octets));
  }
  return tagged(0x82, Buffer.from(host, "utf8"));
}

function pem(label, der) {
  const body = der.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

// The only question asked of it is whether its key is the one the identity attested. The subject, validity window
// and key usages are there because a TLS stack refuses a certificate that omits them, not because anybody reads them.
export function issueLeafCertificate({ commonName, hosts, attest, notBefore = Date.now(), days = 398 }) {
  const names = [...new Set(hosts)].filter(Boolean);
  if (!names.length) throw new Error("a leaf certificate needs at least one address");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: CURVE });
  const spki = publicKey.export({ format: "der", type: "spki" });
  const algorithm = sequence(oid(OIDS.ecdsaWithSha256));
  const subject = sequence(set(sequence(oid(OIDS.commonName), utf8String(commonName))));
  const notAfter = notBefore + days * 24 * 60 * 60 * 1000;
  const tbs = sequence(
    explicit(0, integer(2)),
    integer(crypto.randomBytes(16)),
    algorithm,
    subject,
    sequence(utcTime(notBefore), utcTime(notAfter)),
    subject,
    spki,
    explicit(3, sequence(
      extension(OIDS.basicConstraints, true, sequence()),
      // digitalSignature alone: a usage a certificate does not need is a usage it should not claim.
      extension(OIDS.keyUsage, true, Buffer.from([0x03, 0x02, 0x07, 0x80])),
      extension(OIDS.extKeyUsage, false, sequence(oid(OIDS.serverAuth))),
      extension(OIDS.subjectAltName, false, sequence(...names.map(generalName))),
      ...(attest ? [extension(ATTESTATION_EXTENSION_OID, false, octetString(Buffer.from(attest(spki), "base64")))] : []),
    )),
  );
  const signature = crypto.sign("sha256", tbs, privateKey);
  const certificate = sequence(tbs, algorithm, bitString(signature));
  return {
    certificate: pem("CERTIFICATE", certificate),
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
    spki,
    hosts: names,
    notAfter,
  };
}

export function leafFingerprint(spki) {
  return crypto.createHash("sha256").update(spki).digest();
}

function attestationPayload(identityId, spki) {
  return Buffer.from(`${ATTESTATION_PREFIX}.${identityId}.${leafFingerprint(spki).toString("base64")}`, "utf8");
}

// Found by its OID's encoding rather than by walking the structure: the bytes are this file's own output.
export function embeddedAttestation(certificate) {
  const der = Buffer.isBuffer(certificate) ? certificate : new crypto.X509Certificate(certificate).raw;
  const marker = oid(ATTESTATION_EXTENSION_OID);
  let at = der.indexOf(marker);
  if (at < 0) return null;
  at += marker.length;
  // The OCTET STRING every extension value is wrapped in, then ours.
  if (der[at] !== 0x04 || der[at + 1] !== 66) return null;
  at += 2;
  if (der[at] !== 0x04 || der[at + 1] !== 64) return null;
  return der.subarray(at + 2, at + 2 + 64).toString("base64");
}

export function attestLeaf(identityId, spki, ed25519PrivateKey) {
  return crypto.sign(null, attestationPayload(identityId, spki), ed25519PrivateKey).toString("base64");
}

// Takes the SPKI rather than anything parsed: what is checked is the key, and the rest of the certificate is decoration.
export function verifyLeafAttestation(identityId, spki, attestation, ed25519PublicKey) {
  try {
    return crypto.verify(null, attestationPayload(identityId, spki), ed25519PublicKey, Buffer.from(String(attestation), "base64"));
  } catch {
    return false;
  }
}

// Not re-issued when the addresses change: a shell trusts a leaf because the identity attested it, not because it
// names the address dialled, so a laptop moving between networks keeps its leaf.
export class ServerLeaf {
  constructor(filePath, { now = Date.now, renewWithinMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.renewWithinMs = renewWithinMs;
    this.material = null;
  }

  async ensure({ commonName, hosts, identityId, attest }) {
    if (!this.material) this.material = await this.read();
    if (!this.suits(identityId)) {
      const wanted = [...new Set(hosts)].filter(Boolean).sort();
      this.material = { ...issueLeafCertificate({ commonName, hosts: wanted, attest, notBefore: this.now() }), attestedBy: identityId };
      await this.write();
    }
    return this.material;
  }

  suits(identityId) {
    const held = this.material;
    if (!held || held.attestedBy !== identityId) return false;
    return held.notAfter - this.now() >= this.renewWithinMs;
  }

  async read() {
    let saved = null;
    let text;
    try { text = await fs.readFile(this.filePath, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; return null; }
    try {
      saved = JSON.parse(text);
      // Parsed rather than trusted: a leaf that will not parse is minted again instead of stopping the server.
      const certificate = String(saved.certificate);
      const spki = new crypto.X509Certificate(certificate).publicKey.export({ format: "der", type: "spki" });
      return {
        certificate,
        privateKey: String(saved.privateKey),
        spki,
        hosts: Array.isArray(saved.hosts) ? saved.hosts.map(String) : [],
        notAfter: Number(saved.notAfter),
        // Only a leaf that really carries an attestation counts as attested.
        attestedBy: embeddedAttestation(certificate) ? String(saved.attestedBy || "") : "",
      };
    } catch {
      return null;
    }
  }

  async write() {
    const { certificate, privateKey, hosts, notAfter, attestedBy } = this.material;
    await writePrivateJson(this.filePath, { certificate, privateKey, hosts, notAfter, attestedBy });
  }
}
