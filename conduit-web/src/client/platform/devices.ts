/*
 * The hub's list of devices (GET /v0/nodes) as the client reads it, typed from the declaration (device-api.js): a
 * capability declared there is a field here, of the type it says.
 */
import type { DEVICE_CAPABILITIES, SharedRoot } from "@/device-api.js";

export type { SharedRoot };
type Declared = typeof DEVICE_CAPABILITIES;
type Value<T> = T extends "roots" ? SharedRoot[] : T extends "names" ? string[] : boolean;
export type Capabilities = { [K in keyof Declared]: Value<Declared[K]["type"]> };
/** One environment of a device (the code's node): who it is, whether it is there, and what it can do. */
export type Environment = Capabilities & { id: string; deviceId: string; name: string; platform: string | null; online: boolean; local?: boolean;
  lastSeenAt: string | null; via?: string | null };
/** `hub`: on the device the hub runs on, the server's name. */
export type Device = { id: string; name: string; local?: boolean; hub?: string; nodes: Environment[] };
