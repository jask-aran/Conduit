import {
  formatShortcutBinding, normalizeKeyboardEvent, sameStroke,
} from "./shortcut-normalize.ts";
import { validateShortcutRegistry } from "./shortcut-conflicts.ts";
import {
  clearShortcutOverrides, effectiveShortcutBindings, readShortcutOverrides,
  type ShortcutStorage, writeShortcutOverrides,
} from "./shortcut-preferences.ts";
import {
  SHORTCUT_CONTEXT_PRIORITY,
  type PendingShortcutSequence,
  type ShortcutBinding,
  type ShortcutCommandDefinition,
  type ShortcutContext,
  type ShortcutEnvironment,
  type ShortcutOverrides,
  type ShortcutStroke,
} from "./shortcut-types.ts";

const DEFAULT_SEQUENCE_TIMEOUT_MS = 1500;

export interface ShortcutContextOptions {
  exclusive?: boolean;
  onEscape?: () => void;
  ownsEditableTarget?: boolean;
  priority?: number;
}

interface ActiveContext {
  context: ShortcutContext;
  options: ShortcutContextOptions;
  order: number;
}

interface RegisteredHandler {
  commandId: string;
  context: ShortcutContext;
  run: () => void;
  when?: () => boolean;
  order: number;
}

interface PendingState extends PendingShortcutSequence {
  timer: ReturnType<typeof setTimeout>;
}

export interface ShortcutManagerOptions {
  commands: ShortcutCommandDefinition[];
  environment: ShortcutEnvironment;
  storage?: ShortcutStorage | null;
  sequenceTimeoutMs?: number;
  now?: () => number;
}

export interface RegisterShortcutHandlerOptions {
  when?: () => boolean;
}

const isElement = (value: EventTarget | null): value is Element => typeof Element !== "undefined" && value instanceof Element;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

function isExclusiveTerminalEvent(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  return path.some((target) => isElement(target) && target.getAttribute("data-shortcut-exclusive") === "terminal");
}

function contextRank(context: ShortcutContext): number {
  const index = SHORTCUT_CONTEXT_PRIORITY.indexOf(context as typeof SHORTCUT_CONTEXT_PRIORITY[number]);
  return index < 0 ? SHORTCUT_CONTEXT_PRIORITY.length : index;
}

export class ShortcutManager {
  readonly environment: ShortcutEnvironment;
  readonly commands: ShortcutCommandDefinition[];

  private readonly commandById: Map<string, ShortcutCommandDefinition>;
  private readonly storage: ShortcutStorage | null;
  private readonly sequenceTimeoutMs: number;
  private readonly now: () => number;
  private readonly activeContexts = new Map<symbol, ActiveContext>();
  private readonly handlers = new Map<symbol, RegisteredHandler>();
  private readonly listeners = new Set<() => void>();
  private overrides: ShortcutOverrides;
  private pending: PendingState | null = null;
  private registrationOrder = 0;
  private installedWindow: Window | null = null;

  constructor(options: ShortcutManagerOptions) {
    this.commands = options.commands;
    this.commandById = new Map(options.commands.map((command) => [command.id, command]));
    const registryErrors = validateShortcutRegistry(options.commands);
    if (registryErrors.length) throw new Error(registryErrors.join("\n"));
    this.environment = options.environment;
    this.storage = options.storage === undefined
      ? (typeof localStorage === "undefined" ? null : localStorage)
      : options.storage;
    this.overrides = readShortcutOverrides(this.storage);
    this.sequenceTimeoutMs = options.sequenceTimeoutMs ?? DEFAULT_SEQUENCE_TIMEOUT_MS;
    this.now = options.now || Date.now;
  }

  activateContext(context: ShortcutContext, options: ShortcutContextOptions = {}): () => void {
    const token = Symbol(context);
    this.activeContexts.set(token, { context, options, order: ++this.registrationOrder });
    this.clearPendingSequence();
    this.emit();
    return () => {
      if (!this.activeContexts.delete(token)) return;
      this.clearPendingSequence();
      this.emit();
    };
  }

  registerHandler(
    commandId: string,
    context: ShortcutContext,
    run: () => void,
    options: RegisterShortcutHandlerOptions = {},
  ): () => void {
    const command = this.commandById.get(commandId);
    if (!command) throw new Error(`Cannot register unknown shortcut command: ${commandId}`);
    if (!command.contexts.includes(context)) throw new Error(`Command ${commandId} does not declare the ${context} context`);
    const token = Symbol(commandId);
    this.handlers.set(token, {
      commandId,
      context,
      run,
      when: options.when,
      order: ++this.registrationOrder,
    });
    return () => { this.handlers.delete(token); };
  }

  install(target: Window = window): () => void {
    if (this.installedWindow === target) return () => this.uninstall(target);
    if (this.installedWindow) this.uninstall(this.installedWindow);
    this.installedWindow = target;
    target.addEventListener("keydown", this.handleKeydown, { capture: true });
    target.addEventListener("blur", this.handleBlur);
    return () => this.uninstall(target);
  }

  private uninstall(target: Window): void {
    if (this.installedWindow !== target) return;
    target.removeEventListener("keydown", this.handleKeydown, true);
    target.removeEventListener("blur", this.handleBlur);
    this.installedWindow = null;
    this.clearPendingSequence();
  }

  effectiveBindings(commandId: string): ShortcutBinding[] {
    const command = this.commandById.get(commandId);
    if (!command) return this.overrides[commandId] || [];
    return effectiveShortcutBindings(command, this.overrides);
  }

  formatEffectiveBinding(commandId: string, index = 0): string | null {
    if (!this.commandById.has(commandId)) return null;
    const binding = this.effectiveBindings(commandId)[index];
    return binding ? formatShortcutBinding(binding, this.environment) : null;
  }

  shortcutOverrides(): ShortcutOverrides {
    return Object.fromEntries(Object.entries(this.overrides).map(([commandId, bindings]) => [commandId, [...bindings]]));
  }

  setOverride(commandId: string, bindings: ShortcutBinding[]): void {
    this.overrides = { ...this.overrides, [commandId]: bindings };
    writeShortcutOverrides(this.overrides, this.storage);
    this.clearPendingSequence();
    this.emit();
  }

  resetOverride(commandId: string): void {
    if (!Object.hasOwn(this.overrides, commandId)) return;
    const { [commandId]: _removed, ...remaining } = this.overrides;
    this.overrides = remaining;
    writeShortcutOverrides(this.overrides, this.storage);
    this.clearPendingSequence();
    this.emit();
  }

  resetAllOverrides(): void {
    this.overrides = {};
    clearShortcutOverrides(this.storage);
    this.clearPendingSequence();
    this.emit();
  }

  pendingSequence(): PendingShortcutSequence | null {
    if (!this.pending) return null;
    const { timer: _timer, ...pending } = this.pending;
    return pending;
  }

  isContextActive(context: ShortcutContext): boolean {
    return [...this.activeContexts.values()].some((active) => active.context === context);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clearPendingSequence(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
    this.emit();
  }

  handleKeydown = (event: KeyboardEvent): boolean => {
    if (event.defaultPrevented || event.isComposing || isExclusiveTerminalEvent(event)) return false;
    const stroke = normalizeKeyboardEvent(event, this.environment);
    if (!stroke) return false;

    if (this.pending) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.clearPendingSequence();
        return true;
      }
      if (this.pending.expiresAt <= this.now()) {
        this.clearPendingSequence();
      } else {
        const pending = this.pending;
        const matches = this.matchesForContext(pending.context)
          .filter((match) => match.binding.strokes.length === 2
            && sameStroke(match.binding.strokes[0], pending.firstStroke)
            && sameStroke(match.binding.strokes[1], stroke));
        this.clearPendingSequence();
        const match = matches[0];
        if (!match) return false;
        return this.executeMatch(event, match);
      }
    }

    const contexts = this.orderedActiveContexts();
    if (event.key === "Escape") {
      const escapeOwner = contexts.find((active) => active.options.onEscape);
      if (escapeOwner?.options.onEscape) {
        event.preventDefault();
        event.stopPropagation();
        escapeOwner.options.onEscape();
        return true;
      }
    }
    for (const active of contexts) {
      const matches = this.matchesForContext(active.context)
        .filter((match) => sameStroke(match.binding.strokes[0], stroke)
          && this.eventAllowedForMatch(event, stroke, active, match.command));
      const complete = matches.find((match) => match.binding.strokes.length === 1);
      if (complete) return this.executeMatch(event, complete);
      const sequences = matches.filter((match) => match.binding.strokes.length === 2);
      if (sequences.length) {
        event.preventDefault();
        event.stopPropagation();
        const expiresAt = this.now() + this.sequenceTimeoutMs;
        const timer = setTimeout(() => this.clearPendingSequence(), this.sequenceTimeoutMs);
        this.pending = {
          context: active.context,
          firstStroke: stroke,
          commandIds: [...new Set(sequences.map((match) => match.command.id))],
          expiresAt,
          timer,
        };
        this.emit();
        return true;
      }
      if (active.options.exclusive) return false;
    }
    return false;
  };

  private handleBlur = () => this.clearPendingSequence();

  private orderedActiveContexts(): ActiveContext[] {
    const newestByContext = new Map<ShortcutContext, ActiveContext>();
    for (const active of this.activeContexts.values()) {
      const current = newestByContext.get(active.context);
      if (!current || active.order > current.order) newestByContext.set(active.context, active);
    }
    return [...newestByContext.values()].sort((left, right) =>
      (left.options.priority ?? contextRank(left.context)) - (right.options.priority ?? contextRank(right.context))
      || right.order - left.order);
  }

  private matchesForContext(context: ShortcutContext): Array<{
    binding: ShortcutBinding;
    command: ShortcutCommandDefinition;
    handler: RegisteredHandler;
  }> {
    const matches: Array<{
      binding: ShortcutBinding;
      command: ShortcutCommandDefinition;
      handler: RegisteredHandler;
    }> = [];
    const handlers = [...this.handlers.values()]
      .filter((handler) => handler.context === context && (!handler.when || handler.when()))
      .sort((left, right) => right.order - left.order);
    for (const handler of handlers) {
      const command = this.commandById.get(handler.commandId);
      if (!command) continue;
      for (const binding of this.effectiveBindings(command.id)) matches.push({ binding, command, handler });
    }
    return matches;
  }

  private eventAllowedForMatch(
    event: KeyboardEvent,
    stroke: ShortcutStroke,
    active: ActiveContext,
    command: ShortcutCommandDefinition,
  ): boolean {
    if (event.repeat && !command.allowRepeat) return false;
    if (isEditableTarget(event.target) && stroke.modifiers.length === 0 && !active.options.ownsEditableTarget) return false;
    return true;
  }

  private executeMatch(
    event: KeyboardEvent,
    match: { command: ShortcutCommandDefinition; handler: RegisteredHandler },
  ): true {
    event.preventDefault();
    event.stopPropagation();
    match.handler.run();
    return true;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
