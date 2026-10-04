import { onCleanup, onMount, createSignal } from "solid-js";
import { buildHttpUrl, normalizeServerOrigin } from "../api/transport";
import { publishTrustedIdentities } from "./certificate-pins";
import { dialOrigin, scopeOf, trustedIdentities, type ServerEntry } from "./servers";

/**
 * `conduit-server pair` and "Pair a device" show a QR of a one-time sign-in
 * link, `<server>/v0/auth/handoff?code=…`. A browser that opens it is signed
 * in by the server; the app instead sends the code to `/v0/auth/native-pair`
 * and keeps the token that comes back, as it would after a password.
 *
 * The link's fragment carries the server's identity and network routes
 * (`#conduit=`, base64url JSON). A browser never sends a fragment, so a camera
 * opening the link is unaffected; the app reads it to redeem the code over TLS
 * the identity key vouches for, on the nearest route, so the code never
 * crosses cleartext and the server is saved already knowing who it is.
 */
export interface PairingLink {
  origin: string;
  code: string;
  identity?: { id: string; publicKey: string };
  routes?: string[];
}

export function pairingFragment(identity: { id: string; publicKey: string }, routes: string[]): string {
  const json = JSON.stringify({ id: identity.id, key: identity.publicKey, routes });
  return `#conduit=${btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function readFragment(hash: string): Pick<PairingLink, "identity" | "routes"> {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("conduit");
  if (!value) return {};
  try {
    const bundle = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))) as { id?: unknown; key?: unknown; routes?: unknown };
    if (typeof bundle.id !== "string" || !/^[0-9a-f]{32}$/.test(bundle.id) || typeof bundle.key !== "string" || bundle.key.length > 128) return {};
    const routes = (Array.isArray(bundle.routes) ? bundle.routes : []).flatMap((route) => {
      try { return typeof route === "string" ? [normalizeServerOrigin(route)] : []; } catch { return []; }
    }).slice(0, 8);
    return { identity: { id: bundle.id, publicKey: bundle.key }, routes };
  } catch {
    return {};
  }
}

export function parsePairingLink(text: string): PairingLink | null {
  try {
    const url = new URL(text.trim());
    const code = url.searchParams.get("code");
    if (url.pathname !== "/v0/auth/handoff" || !code) return null;
    return { origin: normalizeServerOrigin(url.origin), code, ...readFragment(url.hash) };
  } catch {
    return null;
  }
}

const RANK = { loopback: 0, private: 1, public: 2 } as const;
const PROBE_TIMEOUT_MS = 3000;

/**
 * Redeem the code, and say which route it was redeemed on.
 *
 * With an identity, every route is asked at once -- local ones over TLS the
 * identity must vouch for -- and the nearest that answers is used. Without
 * one (an old link, or a client whose shell cannot verify), the link's own
 * address is used as it always was.
 */
export async function redeemPairing(link: PairingLink): Promise<{ token: string; origin: string }> {
  let origin = link.origin;
  let dial = link.origin;
  if (link.identity) {
    await publishTrustedIdentities([...trustedIdentities().filter((item) => item.id !== link.identity!.id), link.identity]);
    const entry = { origin: link.origin, name: "", shared: false, tls: true } as ServerEntry;
    const candidates = [...new Set([...(link.routes ?? []), link.origin])]
      .sort((left, right) => RANK[scopeOf(left)] - RANK[scopeOf(right)]);
    const answered = await Promise.all(candidates.map(async (candidate) => {
      const target = dialOrigin(candidate, entry);
      try {
        const response = await fetch(buildHttpUrl("/healthz", target), { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        return response.ok ? target : null;
      } catch {
        return null;
      }
    }));
    const index = answered.findIndex(Boolean);
    if (index >= 0) { origin = candidates[index]!; dial = answered[index]!; }
  }
  const response = await fetch(buildHttpUrl("/v0/auth/native-pair", dial), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code: link.code }),
  });
  const body = await response.json().catch(() => ({})) as { token?: string; message?: string };
  if (!response.ok || !body.token) throw new Error(body.message || "Could not pair with this server.");
  return { token: body.token, origin };
}

export const canScanQr = () => Boolean(navigator.mediaDevices?.getUserMedia);

/** The camera, full screen, until it sees a pairing link. */
export function QrScanner(props: { onLink: (link: PairingLink) => void; onClose: () => void }) {
  let video!: HTMLVideoElement;
  const [message, setMessage] = createSignal("Point the camera at the code from conduit-server pair");
  let stream: MediaStream | null = null;
  let stopped = false;
  let timer = 0;
  onMount(async () => {
    let stage = "QR decoder";
    try {
      const { default: decodeQr } = await import("jsqr");
      if (stopped) return;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Could not read camera frames");
      stage = "Camera";
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (stopped) return stream.getTracks().forEach((track) => track.stop());
      video.srcObject = stream;
      stage = "Camera preview";
      await video.play();
      const look = () => {
        if (stopped) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
          const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = decodeQr(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
          if (code) {
            const link = parsePairingLink(code.data);
            if (link) return props.onLink(link);
            setMessage("That QR code is not a Conduit pairing code");
          }
        }
        timer = window.setTimeout(look, 200);
      };
      stage = "QR scanner";
      look();
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      if (!stopped) setMessage(`${stage} could not start: ${cause instanceof Error ? cause.message : "Unknown error"}. Paste the link from conduit-server pair instead.`);
    }
  });
  onCleanup(() => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); });
  return <div class="qr-scanner" role="dialog" aria-label="Scan pairing code">
    <video ref={video} playsinline muted />
    <div class="qr-scanner-frame" />
    <p>{message()}</p>
    <button type="button" class="qr-scanner-close" onClick={props.onClose}>Cancel</button>
  </div>;
}
