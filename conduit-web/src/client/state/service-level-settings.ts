import type { ServiceLevel, ServiceLevelState } from "../api/contracts";
import { createChatOption } from "./permission-settings";

export function createServiceLevelSettings(onError: (error: unknown) => void, base = "/v0/chats") {
  const { options: levels, selected, select, choose } = createChatOption<ServiceLevel, ServiceLevelState>(onError, base, "service-levels", (state) => state.levels, "serviceLevel");
  return { levels, selected, select, choose };
}

export type ServiceLevelSettings = ReturnType<typeof createServiceLevelSettings>;
