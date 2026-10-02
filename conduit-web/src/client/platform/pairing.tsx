import { onCleanup, onMount, createSignal } from "solid-js";
import { buildHttpUrl, normalizeServerOrigin } from "../api/transport";

/**
 * `conduit-server pair` shows a QR of a one-time sign-in link,
 * `<server>/v0/auth/handoff?code=…`. A browser that opens it is signed in by
 * the server; the app instead sends the code to `/v0/auth/native-pair` and
 * keeps the token that comes back, as it would after a password.
 */
export function parsePairingLink(text: string): { origin: string; code: string } | null {
  try {
    const url = new URL(text.trim());
    const code = url.searchParams.get("code");
    if (url.pathname !== "/v0/auth/handoff" || !code) return null;
    return { origin: normalizeServerOrigin(url.origin), code };
  } catch {
    return null;
  }
}

export async function redeemPairing(link: { origin: string; code: string }): Promise<string> {
  const response = await fetch(buildHttpUrl("/v0/auth/native-pair", link.origin), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code: link.code }),
  });
  const body = await response.json().catch(() => ({})) as { token?: string; message?: string };
  if (!response.ok || !body.token) throw new Error(body.message || "Could not pair with this server.");
  return body.token;
}

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
const BarcodeDetectorClass = () => (globalThis as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector;

export const canScanQr = () => Boolean(BarcodeDetectorClass() && navigator.mediaDevices?.getUserMedia);

/** The camera, full screen, until it sees a pairing link. */
export function QrScanner(props: { onLink: (link: { origin: string; code: string }) => void; onClose: () => void }) {
  let video!: HTMLVideoElement;
  const [message, setMessage] = createSignal("Point the camera at the code from conduit-server pair");
  let stream: MediaStream | null = null;
  let stopped = false;
  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      await video.play();
      const detector = new (BarcodeDetectorClass()!)({ formats: ["qr_code"] });
      const look = async () => {
        if (stopped) return;
        const codes = await detector.detect(video).catch(() => []);
        for (const code of codes) {
          const link = parsePairingLink(code.rawValue);
          if (link) return props.onLink(link);
          setMessage("That QR code is not a Conduit pairing code");
        }
        setTimeout(look, 200);
      };
      void look();
    } catch {
      setMessage("The camera is not available. Paste the link from conduit-server pair instead.");
    }
  });
  onCleanup(() => { stopped = true; stream?.getTracks().forEach((track) => track.stop()); });
  return <div class="qr-scanner" role="dialog" aria-label="Scan pairing code">
    <video ref={video} playsinline muted />
    <div class="qr-scanner-frame" />
    <p>{message()}</p>
    <button type="button" class="qr-scanner-close" onClick={props.onClose}>Cancel</button>
  </div>;
}

