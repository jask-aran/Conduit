import { Dialog } from "@/components/dialog";
import { CardActions, CardCaption, CardQR, CardNote, CardDetails, CardColumns, CardColumn } from "@/components/ui/card";
import { Button as DialogButton } from "@/components/ui/controls";
import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js";

import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl } from "../api/transport";
import { activeServer, pathsOf, serverPathLabel, type ServerPath } from "../platform/servers.ts";
import { shortOrigin } from "./server-switcher";
import { pairingFragment } from "../platform/pairing";

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

export function ConnectDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; addServer: JSX.Element }) {
  const [svg, setSvg] = createSignal("");
  const [link, setLink] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [error, setError] = createSignal("");
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
      // The address a camera opens, plus (in the fragment, which no browser
      // sends) who the server is and its other ways in, for the app.
      const entry = activeServer();
      const routes = entry ? pathsOf(entry).filter((item) => item.scope !== "loopback").map((item) => item.origin) : [];
      const bundle = entry?.id && entry.publicKey ? pairingFragment({ id: entry.id, publicKey: entry.publicKey }, routes) : "";
      const url = `${path.origin}/v0/auth/handoff?code=${encodeURIComponent(body.code)}&after=%2F${bundle}`;
      setLink(url);
      setExpiresAt(Date.parse(body.expiresAt || "") || Date.now() + 300_000);
      // Loaded on first use: the dialog is rare and the encoder is not small.
      const { default: QRCode } = await import("qrcode");
      setSvg(await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#ffffff" } }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  createEffect(on(() => props.open, (open) => {
    if (!open) return;
    void fresh();
  }));
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));
  const left = () => Math.max(0, Math.round((expiresAt() - now()) / 1000));
  const expired = () => Boolean(svg()) && left() === 0;

  return <Dialog open={props.open} onOpenChange={props.onOpenChange} title="Connect" close size="split" >
    <CardColumns>
      <CardColumn title="Pair a device">
    <Show when={route()} fallback={<CardNote>Only this machine reaches {activeServer()?.name || "this server"}. Run <code>conduit-server connect</code> on it to add your network, Tailscale or a tunnel, then pair from here.</CardNote>}>
      <CardQR svg={svg()} expired={expired()} />
      <CardCaption title={route()!.origin}>{shortOrigin(route()!.origin)}</CardCaption>
      <Show when={error()}><CardNote error>{error()}</CardNote></Show>
      {/* The route in the words the menus use; the app takes the nearest
          route that proves it is this server. */}
      <CardDetails>
        <dt>Opens on</dt><dd>{serverPathLabel(route()!)}</dd>
        <dt>Code</dt><dd>{expired() ? "Expired" : svg() ? `Single use · ${Math.floor(left() / 60)}:${String(left() % 60).padStart(2, "0")}` : "…"}</dd>
      </CardDetails>
      <CardActions>
        <DialogButton variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(link())} disabled={!link() || expired()}>Copy link</DialogButton>
        <DialogButton variant="ghost" outline size="sm" onClick={() => void fresh()}>New code</DialogButton>
      </CardActions>
    </Show>
      </CardColumn>
      <CardColumn title="Add server">{props.addServer}</CardColumn>
    </CardColumns>
  </Dialog>;
}
