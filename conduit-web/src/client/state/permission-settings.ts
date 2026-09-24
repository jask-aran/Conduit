import { createSignal } from "solid-js";
import { api, apiWhenServed, asList } from "../api/client";
import type { PermissionMode, PermissionModeState } from "../api/contracts";

type ErrorHandler = (error: unknown) => void;

export function createPermissionSettings(onError: ErrorHandler) {
  const [profiles, setProfiles] = createSignal<PermissionMode[]>([]);
  const [selected, setSelected] = createSignal("");
  let activeChatId = "";
  let requestSequence = 0;

  const select = async (chatId: string) => {
    const changed = activeChatId !== chatId;
    activeChatId = chatId;
    const requestId = ++requestSequence;
    // Drop the previous chat's modes before asking for this one's. They belong
    // to a session with its own harness, and leaving them up for the length of
    // a request put another harness's permission profiles in front of someone
    // -- offering a choice this chat cannot make.
    if (changed) { setProfiles([]); setSelected(""); }
    try {
      const state = await apiWhenServed<PermissionModeState>(`/v0/chats/${encodeURIComponent(chatId)}/permission-profiles`);
      if (activeChatId !== chatId || requestId !== requestSequence) return;
      setProfiles(asList<PermissionMode>(state.modes));
      setSelected(state.selected || "");
    } catch (error) {
      if (activeChatId !== chatId || requestId !== requestSequence) return;
      // Showing nothing is the honest answer when we could not find out.
      setProfiles([]);
      setSelected("");
      onError(error);
    }
  };

  const choose = async (permissionMode: string) => {
    if (!activeChatId || !profiles().some((profile) => profile.id === permissionMode && profile.allowed)) return false;
    const previous = selected();
    setSelected(permissionMode);
    try {
      const state = await api<PermissionModeState>(`/v0/chats/${encodeURIComponent(activeChatId)}/permission-profiles`, {
        method: "PATCH",
        body: JSON.stringify({ permissionMode }),
      });
      setProfiles(asList<PermissionMode>(state.modes));
      setSelected(state.selected || permissionMode);
      return true;
    } catch (error) {
      setSelected(previous);
      onError(error);
      return false;
    }
  };

  return { profiles, selected, select, choose };
}

export type PermissionSettings = ReturnType<typeof createPermissionSettings>;
