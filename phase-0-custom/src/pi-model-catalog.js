import {
  AuthStorage,
  getAgentDir,
  ModelRegistry,
  resolveModelScopeWithDiagnostics,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

export class PiModelCatalog {
  constructor({
    agentDir = getAgentDir(),
    authStorage = AuthStorage.create(),
    modelRegistry,
    settingsFactory = (cwd) => SettingsManager.create(cwd, agentDir, { projectTrusted: true }),
  } = {}) {
    this.agentDir = agentDir;
    this.modelRegistry = modelRegistry || ModelRegistry.create(authStorage);
    this.settingsFactory = settingsFactory;
  }

  async list(cwd) {
    const settings = this.settingsFactory(cwd);
    this.modelRegistry.refresh();

    const patterns = settings.getEnabledModels() || [];
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
      warnings: [...settingsWarnings, ...scope.diagnostics],
    };
  }
}
