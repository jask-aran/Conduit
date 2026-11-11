import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { reachableDevices } from "./device-tools.js";

export function createPersonBrowsers({ own, nodeHub }) {
  const offers = (environment) => (environment.local ? Boolean(own?.available) : Boolean(nodeHub?.live.get(environment.nodeId)?.personBrowser));
  const environments = async () => (await reachableDevices(nodeHub)).filter(offers);
  const reach = (environment) => {
    if (environment.local) return own;
    const ask = async (method, args = []) => {
      const result = await nodeHub.call(environment.nodeId, { target: "personBrowser", method, args, cwd: null }, withAbortSignal(AbortSignal.timeout(150_000), BACKGROUND_CONTEXT));
      if (!result?.ok) throw Object.assign(new Error(result?.error?.message || "The device did not answer"), { status: 502 });
      return result.value;
    };
    return { status: () => ask("status"), pair: () => ask("pair"), unpair: (browser) => ask("unpair", [browser]), launch: () => ask("launch"), tools: () => ask("tools"), call: (name, args) => ask("call", [name, args]) };
  };
  const byId = async (id) => {
    const environment = (await environments()).find((item) => item.nodeId === id);
    if (!environment) throw Object.assign(new Error("That environment does not offer the person's browser"), { status: 404 });
    return reach(environment);
  };
  const pick = async (named, tab = null) => {
    const list = await environments();
    return (named ? list.find((item) => item.name === named) : list.find((item) => tab?.devices.includes(item.name)) || list[0]) || null;
  };
  return { environments, reach, byId, offers, pick };
}
