import * as KDialog from "@kobalte/core/dialog";
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import QRCode from "qrcode";
import { XIcon } from "lucide-solid";
import { Button } from "@/components/primitives";
import { FrostOverlay } from "@/components/frost";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { activeServer, pathsOf, type ServerPath } from "../platform/servers.ts";
import { shortOrigin } from "./server-switcher";

/*
 * Pair a device from a client that is already signed in: the same one-time,
 * five-minute link `conduit-server pair` prints, as a QR. A phone's camera
 * opens it signed in; the app's Scan QR code redeems it for a token.
 *
 * The link is built on the route another device is likeliest to reach --
 * anywhere before this network, and never this machine's loopback, which
 * means nothing to a phone.
 */
const reach = (path: ServerPath) => path.scope === "loopback" ? 0 : path.scope === "private" ? 1 : 2;
const scopeWords = (path: ServerPath) => path.scope === "private" ? "Devices on this network" : "Any device that can reach it";

export function PairDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [svg, setSvg] = createSignal("");
  const [link, setLink] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [error, setError] = createSignal("");
  const [version, setVersion] = createSignal("");
  const route = () => {
    const entry = activeServer();
    const best = entry ? [...pathsOf(entry)].sort((a, b) => reach(b) - reach(a))[0] : undefined;
    return best && reach(best) > 0 ? best : undefined;
  };

  const fresh = async () => {
    setError("");
    setSvg("");
    const path = route();
    if (!path) return;
    try {
      const response = await authorizedFetch(httpUrl("/v0/auth/pairing"), { method: "POST", headers: { accept: "application/json" } });
      const body = await response.json() as { code?: string; expiresAt?: string; message?: string };
      if (!response.ok || !body.code) throw new Error(body.message || "The server would not make a pairing code.");
      const url = `${path.origin}/v0/auth/handoff?code=${encodeURIComponent(body.code)}&after=%2F`;
      setLink(url);
      setExpiresAt(Date.parse(body.expiresAt || "") || Date.now() + 300_000);
      setSvg(await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#ffffff" } }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  createEffect(on(() => props.open, (open) => {
    if (!open) return;
    void fresh();
    void fetch(httpUrl("/healthz"), { cache: "no-store" }).then((r) => r.json()).then((h: { release?: string }) => setVersion(h.release || "")).catch(() => {});
  }));
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));
  const left = () => Math.max(0, Math.round((expiresAt() - now()) / 1000));
  const expired = () => Boolean(svg()) && left() === 0;

  return <FrostOverlay open={props.open} onOpenChange={props.onOpenChange} class="conduit-modal pair-dialog" cardClass="pair-card">
    <div class="pair-head">
      <KDialog.Title>Pair a device</KDialog.Title>
      <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onOpenChange(false)}><XIcon aria-hidden="true" /></Button>
    </div>
    <Show when={route()} fallback={<p class="pair-note">Only this computer can reach {activeServer()?.name || "this server"}. On the server, run <code>conduit-server connect</code> to choose Tailscale, a tunnel or your network, then pair from here.</p>}>
      <div class="pair-qr" data-expired={expired() ? "" : undefined} innerHTML={svg()} aria-label="Pairing QR code" role="img" />
      <Show when={error()}><p class="pair-note pair-error" role="alert">{error()}</p></Show>
      <p class="pair-note">Scan with a phone's camera, or with <strong>Add server → Scan QR code</strong> in the Conduit app. It works once.</p>
      <dl class="pair-details">
        <dt>Server</dt><dd>{activeServer()?.name}</dd>
        <dt>Address</dt><dd>{shortOrigin(route()!.origin)}</dd>
        <dt>Reachable by</dt><dd>{scopeWords(route()!)}</dd>
        <Show when={version()}><dt>Version</dt><dd>{version()}</dd></Show>
        <dt>Code</dt><dd>{expired() ? "Expired" : svg() ? `Expires in ${Math.floor(left() / 60)}:${String(left() % 60).padStart(2, "0")}` : "…"}</dd>
      </dl>
      <div class="pair-actions">
        <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(link())} disabled={!link() || expired()}>Copy link</Button>
        <Button variant="outline" size="sm" onClick={() => void fresh()}>New code</Button>
      </div>
    </Show>
  </FrostOverlay>;
}
