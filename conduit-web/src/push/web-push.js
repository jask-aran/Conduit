import crypto from "node:crypto";

/** Web Push on node:crypto alone: RFC 8291 message encryption (aes128gcm, one record) and RFC 8292 VAPID. */

export function generateVapidKeys() {
  const keys = crypto.createECDH("prime256v1");
  keys.generateKeys();
  const scalar = keys.getPrivateKey();
  const privateKey = Buffer.alloc(32);
  // ECDH omits leading zero bytes; JWK requires the full scalar width.
  scalar.copy(privateKey, 32 - scalar.length);
  return { publicKey: keys.getPublicKey().toString("base64url"), privateKey: privateKey.toString("base64url") };
}

export function encrypt({ p256dh, auth } = {}, plaintext, options = {}) {
  if (typeof p256dh !== "string") throw new Error("p256dh must be a 65-byte uncompressed point");
  if (typeof auth !== "string") throw new Error("auth must be 16 bytes");
  const clientKey = Buffer.from(p256dh, "base64url");
  const authSecret = Buffer.from(auth, "base64url");
  if (clientKey.length !== 65 || clientKey[0] !== 4) throw new Error("p256dh must be a 65-byte uncompressed point");
  if (authSecret.length !== 16) throw new Error("auth must be 16 bytes");
  plaintext = Buffer.from(plaintext);
  if (plaintext.length + 1 + 16 > 4096) throw new Error("plaintext is too large for one record");
  const salt = options.salt || crypto.randomBytes(16);
  if (!Buffer.isBuffer(salt) || salt.length !== 16) throw new Error("salt must be a 16-byte Buffer");
  const ecdh = crypto.createECDH("prime256v1");
  if (options.serverKeys) ecdh.setPrivateKey(options.serverKeys.privateKey);
  else ecdh.generateKeys();
  const serverKey = ecdh.getPublicKey();
  if (options.serverKeys && !serverKey.equals(options.serverKeys.publicKey)) throw new Error("server keys do not match");
  let secret;
  try { secret = ecdh.computeSecret(clientKey); }
  catch { throw new Error("p256dh must be a valid 65-byte uncompressed point"); }
  const ikm = crypto.hkdfSync("sha256", secret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), clientKey, serverKey]), 32);
  const cek = crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header[20] = serverKey.length;
  return Buffer.concat([header, serverKey, record]);
}

export function vapidAuthorization({ endpoint, subject, publicKey, privateKey, expiresAt }) {
  const raw = Buffer.from(publicKey, "base64url");
  const key = crypto.createPrivateKey({ key: {
    kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"),
    y: raw.subarray(33, 65).toString("base64url"), d: privateKey,
  }, format: "jwk" });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({ aud: new URL(endpoint).origin, exp: expiresAt ?? Math.floor(Date.now() / 1000) + 43200, sub: subject })}`;
  const signature = crypto.sign("sha256", Buffer.from(token), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${token}.${signature}, k=${publicKey}`;
}
