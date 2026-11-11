import type { DEVICE_CAPABILITIES, SharedRoot } from "@/device-api.js";

export type { SharedRoot };
type Declared = typeof DEVICE_CAPABILITIES;
type Value<T> = T extends "roots" ? SharedRoot[] : T extends "names" ? string[] : boolean;
export type Capabilities = { [K in keyof Declared]: Value<Declared[K]["type"]> };
/** One environment of a device (the code's node). */
export type Environment = Capabilities & { id: string; deviceId: string; name: string; platform: string | null; online: boolean; local?: boolean;
  lastSeenAt: string | null; via?: string | null };
/** `hub`: the server's name, on the device the hub runs on. */
export type Device = { id: string; name: string; local?: boolean; hub?: string; nodes: Environment[] };
