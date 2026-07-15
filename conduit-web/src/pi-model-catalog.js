import {
  AuthStorage,
  getAgentDir,
  ModelRegistry,
  resolveModelScopeWithDiagnostics,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import path from "node:path";

export class PiModelCatalog {
  constructor({
    agentDir = getAgentDir(),
    authStorage,
    modelRegistry,
    modelPatterns = [],
    settingsFactory = (cwd) => SettingsManager.create(cwd, agentDir, { projectTrusted: false }),
  } = {}) {
    this.agentDir = agentDir;
    this.authStorage = authStorage || (modelRegistry ? null : AuthStorage.create(path.join(agentDir, "auth.json")));
    this.modelRegistry = modelRegistry || ModelRegistry.create(this.authStorage, path.join(agentDir, "models.json"));
    this.modelPatterns = modelPatterns;
    this.settingsFactory = settingsFactory;
  }

  async list(cwd) {
    const settings = this.settingsFactory(cwd);
    this.authStorage?.reload();
    this.modelRegistry.refresh();

    const patterns = this.modelPatterns;
    const scope = patterns.length
      ? await resolveModelScopeWithDiagnostics(patterns, this.modelRegistry)
      : { scopedModels: [], diagnostics: [] };
    const entries = scope.scopedModels.length
      ? scope.scopedModels
      : this.modelRegistry.getAvailable().map((model) => ({ model }));
    const savedProvider = settings.getDefaultProvider();
    const savedModel = settings.getDefaultModel();
    const savedEntry = entries.find(({ model }) => model.provider === savedProvider && model.id === savedModel);
    const defaultEntry = savedEntry || entries[0];
    const configuredThinkingLevel = defaultEntry?.thinkingLevel || settings.getDefaultThinkingLevel() || "medium";
    const defaultThinkingLevel = defaultEntry
      ? clampThinkingLevel(defaultEntry.model, configuredThinkingLevel)
      : configuredThinkingLevel;
    const settingsWarnings = settings.drainErrors().map(({ scope: source, error }) => ({
      type: "warning",
      message: `${source} settings: ${error.message}`,
    }));

    return {
      models: entries.map(({ model }) => ({
        provider: model.provider,
        id: model.id,
        spec: `${model.provider}/${model.id}`,
        label: model.name || model.id,
        reasoning: model.reasoning === true,
        thinkingLevels: getSupportedThinkingLevels(model),
      })),
      defaultModel: defaultEntry ? `${defaultEntry.model.provider}/${defaultEntry.model.id}` : null,
      defaultThinkingLevel,
      requiresAuthentication: entries.length === 0,
      warnings: [...settingsWarnings, ...scope.diagnostics],
    };
  }
}
