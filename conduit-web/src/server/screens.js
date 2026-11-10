/*
 * Screens (docs/plans/screens-and-device-control.md): something on a device that has a picture, takes input and can be
 * acted on, named by its view id `<kind>:<device>` -- what a pane shows and an agent asks for (conduit_ui open). One
 * list across kinds, each kind kept by its own host: browsers today (browser-host.js: the hub's, and a device's through
 * its node's tunnel); a desktop and a phone join here as a kind each.
 *
 * A screen: `{ view, kind, device, available, shownOn }` -- `device` as the devices tool names it ("Hub" for the hub's
 * own), `shownOn` the clients with it in a pane. `mayAct` is the rule for an agent acting on one (decision 8): the
 * hub's browser whenever, a device's only while some client shows it.
 */
export function createScreens({ browsers, uiControl }) {
  const list = async () => {
    const [found, tabs] = await Promise.all([browsers.list(), uiControl.look()]);
    return found.map((browser) => {
      const view = `browser:${browser.id}`;
      return { view, kind: "browser", device: browser.name, available: Boolean(browser.available),
        shownOn: tabs.filter((tab) => tab.panes.some((pane) => pane.view === view)).map((tab) => tab.client) };
    });
  };
  return {
    list,
    async mayAct(view) {
      if (view === "browser:hub") return true;
      return Boolean((await list()).find((screen) => screen.view === view)?.shownOn.length);
    },
  };
}

/** The `conduit_ui` tool's description of the screens: one line each. */
export const describeScreens = (screens) => screens.map((screen) =>
  `${screen.view}: ${screen.device}'s ${screen.kind}${screen.available ? "" : " (not reachable now)"}${screen.shownOn.length ? `, shown on ${screen.shownOn.join(", ")}` : ""}`).join("\n")
  || "No screens.";
