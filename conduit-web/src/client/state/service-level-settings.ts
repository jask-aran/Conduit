import { createSignal } from "solid-js";
import { api, apiWhenServed, asList } from "../api/client";
import type { ServiceLevel, ServiceLevelState } from "../api/contracts";

type ErrorHandler = (error: unknown) => void;

export function createServiceLevelSettings(onError: ErrorHandler, base = "/v0/chats") {
  const [levels, setLevels] = createSignal<ServiceLevel[]>([]);
  const [selected, setSelected] = createSignal("");
  let activeChatId = "";
  let requestSequence = 0;

  const select = async (chatId: string) => {
    const changed = activeChatId !== chatId;
    activeChatId = chatId;
    const requestId = ++requestSequence;
    if (changed) { setLevels([]); setSelected(""); }
    try {
      const state = await apiWhenServed<ServiceLevelState>(`${base}/${encodeURIComponent(chatId)}/service-levels`);
      if (activeChatId !== chatId || requestId !== requestSequence) return;
      setLevels(asList<ServiceLevel>(state.levels));
      setSelected(state.selected || "");
    } catch (error) {
      if (activeChatId !== chatId || requestId !== requestSequence) return;
      setLevels([]);
      setSelected("");
      onError(error);
    }
  };

  const choose = async (serviceLevel: string) => {
    if (!activeChatId || !levels().some((level) => level.id === serviceLevel)) return false;
    const previous = selected();
    setSelected(serviceLevel);
    try {
      const state = await api<ServiceLevelState>(`${base}/${encodeURIComponent(activeChatId)}/service-levels`, {
        method: "PATCH",
        body: JSON.stringify({ serviceLevel }),
      });
      setLevels(asList<ServiceLevel>(state.levels));
      setSelected(state.selected || serviceLevel);
      return true;
    } catch (error) {
      setSelected(previous);
      onError(error);
      return false;
    }
  };

  return { levels, selected, select, choose };
}

export type ServiceLevelSettings = ReturnType<typeof createServiceLevelSettings>;
