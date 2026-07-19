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

  async snapshot(cwd) {
    const settings = this.settingsFactory(cwd);
    this.authStorage?.reload();
    this.modelRegistry.refresh();

    const configuredModels = settings.getEnabledModels?.();
    const modelPatterns = Array.isArray(configuredModels) ? configuredModels : this.modelPatterns;
    const scope = modelPatterns.length
      ? await resolveModelScopeWithDiagnostics(modelPatterns, this.modelRegistry)
      : { scopedModels: [], diagnostics: [] };
    const availableEntries = this.modelRegistry.getAvailable().map((model) => ({ model }));
    const entries = modelPatterns.length
      ? scope.scopedModels
      : availableEntries;
    const enabledModels = entries.map(({ model }) => `${model.provider}/${model.id}`);
    const savedProvider = settings.getDefaultProvider();
    const savedModel = settings.getDefaultModel();
    const savedEntry = entries.find(({ model }) => model.provider === savedProvider && model.id === savedModel);
    const defaultEntry = savedEntry || entries[0];
    const configuredThinkingLevel = defaultEntry?.thinkingLevel || settings.getDefaultThinkingLevel() || "medium";
    const defaultThinkingLevel = defaultEntry
      ? clampThinkingLevel(defaultEntry.model, configuredThinkingLevel)
      : configuredThinkingLevel;
    const settingsErrors = settings.drainErrors();
    const settingsWarnings = settingsErrors.map(({ scope: source, error }) => ({
      type: "warning",
      message: `${source} settings: ${error.message}`,
    }));

    return {
      settings,
      availableEntries,
      enabledModels,
      entries,
      defaultEntry,
      defaultThinkingLevel,
      settingsErrors,
      diagnostics: [...settingsWarnings, ...scope.diagnostics],
    };
  }

  modelView({ model }) {
    return {
      provider: model.provider,
      id: model.id,
      spec: `${model.provider}/${model.id}`,
      label: model.name || model.id,
      reasoning: model.reasoning === true,
      thinkingLevels: getSupportedThinkingLevels(model),
    };
  }

  async list(cwd) {
    const snapshot = await this.snapshot(cwd);
    return {
      models: snapshot.entries.map((entry) => this.modelView(entry)),
      defaultModel: snapshot.defaultEntry
        ? `${snapshot.defaultEntry.model.provider}/${snapshot.defaultEntry.model.id}`
        : null,
      defaultThinkingLevel: snapshot.defaultThinkingLevel,
      requiresAuthentication: snapshot.entries.length === 0,
      warnings: snapshot.diagnostics,
    };
  }

  async getSettings(cwd) {
    const snapshot = await this.snapshot(cwd);
    return {
      models: snapshot.availableEntries.map((entry) => this.modelView(entry)),
      enabledModels: snapshot.enabledModels,
      defaultModel: snapshot.defaultEntry
        ? `${snapshot.defaultEntry.model.provider}/${snapshot.defaultEntry.model.id}`
        : null,
    };
  }

  async updateSettings(cwd, input = {}) {
    const snapshot = await this.snapshot(cwd);
    if (snapshot.settingsErrors.length) throw snapshot.settingsErrors[0].error;
    const requested = input.enabledModels;
    const available = new Set(snapshot.availableEntries.map(({ model }) => `${model.provider}/${model.id}`));
    if (!Array.isArray(requested) || requested.length === 0) {
      const error = new Error("Choose at least one scoped model");
      error.code = "enabled_models_required";
      throw error;
    }
    const enabledModels = [...new Set(requested.map((spec) => String(spec || "").trim()))];
    if (enabledModels.some((spec) => !available.has(spec))) {
      const error = new Error("Scoped models must be available in Pi");
      error.code = "invalid_enabled_model";
      throw error;
    }

    const requestedDefault = String(input.defaultModel || "").trim();
    if (requestedDefault && !enabledModels.includes(requestedDefault)) {
      const error = new Error("The default model must be in the enabled scope");
      error.code = "invalid_default_model";
      throw error;
    }
    snapshot.settings.setEnabledModels(enabledModels);
    const currentDefault = snapshot.defaultEntry
      ? `${snapshot.defaultEntry.model.provider}/${snapshot.defaultEntry.model.id}`
      : null;
    if (requestedDefault || !currentDefault || !enabledModels.includes(currentDefault)) {
      const defaultModel = requestedDefault || enabledModels[0];
      const fallback = snapshot.availableEntries.find(({ model }) =>
        `${model.provider}/${model.id}` === defaultModel);
      if (fallback) snapshot.settings.setDefaultModelAndProvider(fallback.model.provider, fallback.model.id);
    }
    await snapshot.settings.flush();
    const writeErrors = snapshot.settings.drainErrors();
    if (writeErrors.length) throw writeErrors[0].error;
    return this.getSettings(cwd);
  }

  async updateDefault(cwd, spec, thinkingLevel = "") {
    const snapshot = await this.snapshot(cwd);
    if (snapshot.settingsErrors.length) throw snapshot.settingsErrors[0].error;
    const entry = snapshot.entries.find(({ model }) => `${model.provider}/${model.id}` === spec);
    if (!entry) {
      const error = new Error("The selected model is not in this Pi installation's enabled scope");
      error.code = "invalid_model";
      throw error;
    }
    snapshot.settings.setDefaultModelAndProvider(entry.model.provider, entry.model.id);
    if (thinkingLevel) snapshot.settings.setDefaultThinkingLevel(clampThinkingLevel(entry.model, thinkingLevel));
    await snapshot.settings.flush();
    const writeErrors = snapshot.settings.drainErrors();
    if (writeErrors.length) throw writeErrors[0].error;
    return this.list(cwd);
  }

  getLaunchModels(cwd) {
    const configured = this.settingsFactory(cwd).getEnabledModels?.();
    return Array.isArray(configured) ? configured : this.modelPatterns;
  }
}
