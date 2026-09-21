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
    SystemBars: {
      insetsHandling: "css",
      style: "DARK",
    },
  },
};

export default config;
