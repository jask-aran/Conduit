import { createSignal, untrack } from "solid-js";
import { api, apiWhenServed, asList } from "../api/client";
import type { PermissionMode, PermissionModeState } from "../api/contracts";
import { createLatest } from "./latest";

type ErrorHandler = (error: unknown) => void;

/**
 * One of a chat's options its harness offers (permission profiles, service levels): select reads them for a chat,
 * choose sets one. path: the chat's resource for them; list: the options in its answer; field: the name a choice is
 * sent under; usable: whether an option can be chosen.
 */
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
    // Drop the previous chat's options before asking for this one's. They belong
    // to a session with its own harness, and leaving them up for the length of
    // a request put another harness's permission profiles in front of someone
    // -- offering a choice this chat cannot make.
    if (changed) { setOptions([]); setSelected(""); }
    try {
      const state = await apiWhenServed<State>(`${base}/${encodeURIComponent(chatId)}/${path}`);
      if (!current()) return;
      setOptions(asList<Option>(list(state)));
      setSelected(state.selected || "");
    } catch (error) {
      if (!current()) return;
      // Showing nothing is the honest answer when we could not find out.
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
   * The harness changed mode itself -- Claude Code does when an approval turns
   * on accepting edits, or a plan is approved -- and its process says which it
   * is in now. Read untracked, so following it never answers a choice of the
   * user's with the mode it is replacing.
   */
  const follow = (id: string, permissionMode?: string) => untrack(() => {
    if (id !== chatId() || !permissionMode || permissionMode === selected()) return;
    if (profiles().some((profile) => profile.id === permissionMode)) setSelected(permissionMode);
  });

  return { profiles, selected, select, choose, follow };
}

export type PermissionSettings = ReturnType<typeof createPermissionSettings>;
