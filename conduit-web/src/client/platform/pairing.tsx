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

export const canScanQr = () => Boolean(navigator.mediaDevices?.getUserMedia);

/** The camera, full screen, until it sees a pairing link. */
export function QrScanner(props: { onLink: (link: { origin: string; code: string }) => void; onClose: () => void }) {
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
