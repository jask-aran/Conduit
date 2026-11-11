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

export const describeScreens = (screens) => screens.map((screen) =>
  `${screen.view}: ${screen.device}'s ${screen.kind}${screen.available ? "" : " (not reachable now)"}${screen.shownOn.length ? `, shown on ${screen.shownOn.join(", ")}` : ""}`).join("\n")
  || "No screens.";
