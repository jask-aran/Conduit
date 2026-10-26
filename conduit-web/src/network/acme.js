import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

export const LETS_ENCRYPT = "https://acme-v02.api.letsencrypt.org/directory";
export const LETS_ENCRYPT_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory";
const b64 = (value) => Buffer.from(value).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(value).digest("base64url");
const keyPair = () => crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pemKey = (key) => key.export({ type: "pkcs8", format: "pem" });

// DER lengths, sequences and the OIDs used by this DNS-only PKCS#10 request.
function der(tag, ...parts) {
  const body = Buffer.concat(parts.map((part) => Buffer.from(part)));
  let length = Buffer.from([body.length]);
  if (body.length >= 128) {
    let hex = body.length.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    const bytes = Buffer.from(hex, "hex");
    length = Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, body]);
}
const seq = (...parts) => der(0x30, ...parts);
const oid = (hex) => der(0x06, Buffer.from(hex, "hex"));
function csrFor(names, privateKey, publicKey) {
  const subject = seq(der(0x31, seq(oid("550403"), der(0x0c, Buffer.from(names[0])))));
  const san = seq(oid("551d11"), der(0x04, seq(...names.map((name) => der(0x82, Buffer.from(name))))));
  const extensions = seq(oid("2a864886f70d01090e"), der(0x31, seq(san)));
  const info = seq(der(0x02, [0]), subject, publicKey.export({ type: "spki", format: "der" }), der(0xa0, extensions));
  return seq(info, seq(oid("2a8648ce3d040302")), der(0x03, [0], crypto.sign("sha256", info, { key: privateKey, dsaEncoding: "der" })));
}

async function publicTxt(recordName, value, fetchImpl = fetch) {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    try {
      const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?${new URLSearchParams({ name: recordName, type: "TXT" })}`, {
        headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(Math.min(10_000, until - Date.now())),
      });
      const data = await response.json();
      if (response.ok && data.Answer?.some((answer) => answer.type === 16 && answer.data?.includes(value))) {
        await sleep(5_000);
        return;
      }
    } catch {}
    await sleep(Math.min(4_000, Math.max(0, until - Date.now())));
  }
  throw new Error(`Public DNS did not show the challenge for ${recordName} within two minutes`);
}

export async function issueCertificate({ names, dns, accountKey = null, directoryUrl = LETS_ENCRYPT, log = console, fetchImpl = fetch, waitForTxt = publicTxt }) {
  if (!Array.isArray(names) || !names.length) throw new Error("At least one certificate name is required");
  const request = (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const directoryResponse = await request(directoryUrl);
  if (!directoryResponse.ok) throw new Error(`ACME directory request failed (${directoryResponse.status})`);
  const directory = await directoryResponse.json();
  const key = accountKey ? crypto.createPrivateKey(accountKey) : keyPair().privateKey;
  accountKey = pemKey(key);
  const exported = crypto.createPublicKey(key).export({ format: "jwk" });
  const jwk = { crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y };
  const thumbprint = hash(JSON.stringify(jwk));
  let nonce;
  let kid;
  async function post(url, payload, retry = true) {
    if (!nonce) {
      const response = await request(directory.newNonce, { method: "HEAD" });
      nonce = response.headers.get("replay-nonce");
      if (!nonce) throw new Error("ACME did not return a nonce");
    }
    const protectedHeader = b64(JSON.stringify({ alg: "ES256", nonce, url, ...(kid ? { kid } : { jwk }) }));
    nonce = null;
    const encoded = payload === undefined ? "" : b64(JSON.stringify(payload));
    const signature = b64(crypto.sign("sha256", Buffer.from(`${protectedHeader}.${encoded}`), { key, dsaEncoding: "ieee-p1363" }));
    const response = await request(url, { method: "POST", headers: { "content-type": "application/jose+json" }, body: JSON.stringify({ protected: protectedHeader, payload: encoded, signature }) });
    nonce = response.headers.get("replay-nonce");
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!response.ok) {
      if (retry && data?.type === "urn:ietf:params:acme:error:badNonce") return post(url, payload, false);
      throw new Error(data?.detail || `ACME request failed (${response.status})`);
    }
    return { data, location: response.headers.get("location") };
  }
  async function poll(url, complete) {
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      const { data } = await post(url);
      if (["invalid", "expired", "revoked", "deactivated"].includes(data.status) || data.challenges?.some((challenge) => challenge.status === "invalid")) {
        throw new Error(data.error?.detail || data.challenges?.find((challenge) => challenge.error)?.error.detail || `ACME status: ${data.status}`);
      }
      if (complete.includes(data.status)) return data;
      await sleep(2_000);
    }
    throw new Error("ACME did not finish within two minutes");
  }
  log.info?.("Asking Let's Encrypt");
  const account = await post(directory.newAccount, { termsOfServiceAgreed: true });
  kid = account.location;
  if (!kid) throw new Error("ACME did not return an account URL");
  const order = await post(directory.newOrder, { identifiers: names.map((value) => ({ type: "dns", value })) });
  if (!order.location) throw new Error("ACME did not return an order URL");
  for (const url of order.data.authorizations) {
    const { data: auth } = await post(url);
    if (auth.status === "valid") continue;
    const challenge = auth.challenges?.find((challenge) => challenge.type === "dns-01");
    if (!challenge) throw new Error("ACME did not offer a DNS challenge");
    const name = auth.identifier.value.replace(/^\*\./, "");
    const recordName = `_acme-challenge.${name}`;
    const value = hash(`${challenge.token}.${thumbprint}`);
    log.info?.(`Publishing the challenge for ${auth.wildcard ? "*." : ""}${name}`);
    const handle = await dns.present(recordName, value);
    let failure;
    try {
      log.info?.("Waiting for public DNS");
      await waitForTxt(recordName, value, fetchImpl);
      log.info?.("Asking Let's Encrypt");
      await post(challenge.url, {});
      await poll(url, ["valid"]);
    } catch (error) { failure = error; throw error; }
    finally {
      try { await dns.cleanup(handle); }
      catch (error) {
        if (!failure) throw error;
        log.warn?.(`Could not remove the DNS challenge: ${error.message}`);
      }
    }
  }
  const ready = await poll(order.location, ["ready", "valid"]);
  if (ready.status !== "ready") throw new Error("ACME order was finalized before this certificate key was submitted");
  const certificateKeys = keyPair();
  const csr = csrFor(names, certificateKeys.privateKey, certificateKeys.publicKey);
  await post(order.data.finalize, { csr: b64(csr) });
  const issued = await poll(order.location, ["valid"]);
  if (!issued.certificate) throw new Error("ACME did not return a certificate URL");
  const { data: certificate } = await post(issued.certificate);
  if (typeof certificate !== "string" || !certificate.includes("-----BEGIN CERTIFICATE-----")) throw new Error("ACME did not return a PEM certificate");
  return { certificate, privateKey: pemKey(certificateKeys.privateKey), accountKey };
}
