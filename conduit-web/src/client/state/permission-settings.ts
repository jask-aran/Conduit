import { createSignal, untrack } from "solid-js";
import { api, apiWhenServed, asList } from "../api/client";
import type { PermissionMode, PermissionModeState } from "../api/contracts";
import { createLatest } from "./latest";

type ErrorHandler = (error: unknown) => void;

export function createChatOption<Option extends { id: string }, State extends { selected: string }>(onError: ErrorHandler, base: string,
  path: string, list: (state: State) => unknown, field: string, usable: (option: Option) => boolean = () => true) {
  const [options, setOptions] = createSignal<Option[]>([]);
  const [selected, setSelected] = createSignal("");
  let activeChatId = "";
  const request = createLatest();

  const select = async (chatId: string) => {
    const changed = activeChatId !== chatId;
    activeChatId = chatId;
    const current = request.next();
    // The previous chat's options belong to another harness and would offer a choice this chat cannot make.
    if (changed) { setOptions([]); setSelected(""); }
    try {
      const state = await apiWhenServed<State>(`${base}/${encodeURIComponent(chatId)}/${path}`);
      if (!current()) return;
      setOptions(asList<Option>(list(state)));
      setSelected(state.selected || "");
    } catch (error) {
      if (!current()) return;
      setOptions([]);
      setSelected("");
      onError(error);
    }
  };

  const choose = async (id: string) => {
    if (!activeChatId || !options().some((option) => option.id === id && usable(option))) return false;
    const previous = selected();
    setSelected(id);
    try {
      const state = await api<State>(`${base}/${encodeURIComponent(activeChatId)}/${path}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: id }),
      });
      setOptions(asList<Option>(list(state)));
      setSelected(state.selected || id);
      return true;
    } catch (error) {
      setSelected(previous);
      onError(error);
      return false;
    }
  };

  return { options, selected, setSelected, select, choose, chatId: () => activeChatId };
}

export function createPermissionSettings(onError: ErrorHandler, base = "/v0/chats") {
  const { options: profiles, selected, setSelected, select, choose, chatId } = createChatOption<PermissionMode, PermissionModeState>(onError, base,
    "permission-profiles", (state) => state.modes, "permissionMode", (profile) => profile.allowed);

  /**
   * The harness changed mode itself (Claude Code does when a plan is approved). Untracked, so following it never
   * answers the user's choice with the mode it is replacing.
   */
  const follow = (id: string, permissionMode?: string) => untrack(() => {
    if (id !== chatId() || !permissionMode || permissionMode === selected()) return;
    if (profiles().some((profile) => profile.id === permissionMode)) setSelected(permissionMode);
  });

  return { profiles, selected, select, choose, follow };
}

export type PermissionSettings = ReturnType<typeof createPermissionSettings>;
