# Browser transport v2: proxy spike (2026-11-02)

Roadmap #8 asked whether the Browser pane could show pages by proxying them -- each site on an origin of its own under
the hub, framed in Conduit, its security headers kept -- with streaming as the fallback. A spike, not shipped:
`conduit-web/scripts/spikes/browser-proxy-spike.mjs` runs a resisting site, a proxy giving it its own origin (a hub
port) and a Conduit-like parent framing it, and a headless browser reports what survives.

## What works

| Check | Result |
| --- | --- |
| The site's own framing refusal (X-Frame-Options DENY, CSP frame-ancestors 'self') | holds when framed directly |
| Proxied: X-Frame-Options dropped, frame-ancestors rewritten to Conduit's origin | the page frames |
| A script injected by the proxy, admitted by a nonce added to script-src | runs, and tells Conduit its URL and title (postMessage) |
| The site's own nonce'd scripts | still run |
| Absolute same-origin fetch and WebSocket, rewritten in the HTML, connect-src widened | work, through the proxy |
| Absolute links and absolute redirects (Location rewritten) | stay in the proxy |
| Set-Cookie (Domain dropped) | set on the proxy's origin |

So header surgery is straightforward: framing, the nonce, connect-src, Location and cookies each take a line.

## What does not

1. **Ports are not cookie boundaries.** Cookies are scoped by host, not port, so a site proxied on `hub:7101` shares
   one cookie jar with Conduit on `hub:4310` and with every other proxied site. The spike shows Conduit's own session
   cookie reaching the site through the proxy (`conduit_session=person-token` in the site's request). The proxy must
   strip Conduit's cookies whatever else is decided, and per-site isolation needs per-site **hosts**, not ports.
2. **Per-site hosts need wildcard DNS and TLS.** `site-x.hub…` for each site means a wildcard name and certificate.
   Tailscale's MagicDNS names and certificates are per machine, with no wildcard, so over the tailnet this needs a
   domain the person owns (public DNS, a DNS-01 wildcard certificate) pointed at the hub.
3. **URLs built at runtime escape.** The proxy rewrites URLs it can see in the HTML; a URL a script builds (`site +
   "/x"`) still points at the real site. Closing that needs a service worker on each proxied origin (intercepting every
   request) or patching `fetch`/`XMLHttpRequest`/`WebSocket`/`location` at runtime -- the hard, never-finished part of
   every rewriting proxy.
4. **Two networks.** Cross-origin subresources (CDNs, embeds) load straight from the person's browser, not the hub, so
   one page is fetched from two places; sites with bot checks see that, and the hub's session is not the person's.

## Recommendation

Keep streaming (#7, agent-browser's stream) as the transport. Proxying is worth it only for chosen sites where fidelity
or input latency matters, and only once (1) the proxy strips the hub's cookies, (2) the person has a domain for
per-site hosts, and (3) a service worker per proxied origin closes the runtime-URL gap. Until then the cost is a
security boundary Conduit does not have.
