import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jaskaran.conduit",
  appName: "Conduit",
  webDir: "dist",
  android: {
    /*
     * The shell's page is `https://localhost`, so a call to a plain-HTTP
     * server on the LAN is active mixed content and the WebView refuses it
     * whatever the OS permits. This is the WebView's own rule, and it is
     * per-WebView rather than per-destination -- there is no narrower form of
     * it.
     *
     * What keeps that from meaning "anything goes" is the layer above:
     * `normalizeServerOrigin` accepts http:// only for loopback and the
     * private ranges, so the only cleartext address the client can ever hold
     * is one that cannot leave the network in front of the person. See
     * `res/xml/network_security_config.xml`, which says the same thing about
     * the OS half.
     */
    allowMixedContent: true,
  },
  plugins: {
    /*
     * Resize nothing: `--app-height` in `mobile-layout.ts` sizes the shell, and
     * two things moving the same surface is how the composer ends up fighting
     * the transcript. The keyboard's height comes from `ConduitKeyboardPlugin`
     * instead, which reports it every frame it is moving rather than once at
     * the end.
     */
    Keyboard: {
      resize: "none" as never,
    },
    SystemBars: {
      /*
       * `css` pads the WebView's parent by the keyboard's height when the
       * keyboard settles, which is a second thing moving the shell and a
       * discrete jump where the page is drawing a curve. Turning the listener
       * off also turns off the `--safe-area-inset-*` variables it injected, so
       * `ConduitKeyboardPlugin` injects them -- same names, same values.
       */
      insetsHandling: "disable",
      style: "DARK",
    },
  },
};

export default config;
