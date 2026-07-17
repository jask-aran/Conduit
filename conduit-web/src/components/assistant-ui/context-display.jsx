/**
 * Adapted from Assistant UI Context Display (registry source).
 * Props-driven usage only — no Assistant UI runtime or AI SDK hooks.
 * Null tokens/percent render as unknown, never 0%.
 */
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { createContext, useContext, useMemo } from "react";

const formatTokenCount = (tokens) => {
  if (tokens == null || !Number.isFinite(tokens)) return "—";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(tokens)}`;
};

const getUsageSeverity = (percent) => {
  if (percent == null || !Number.isFinite(percent)) return "unknown";
  if (percent > 85) return "critical";
  if (percent >= 65) return "warning";
  return "normal";
};

const getStrokeColor = (percent, compacting) => {
  if (compacting) return "stroke-muted-foreground";
  const severity = getUsageSeverity(percent);
  if (severity === "critical") return "stroke-red-500";
  if (severity === "warning") return "stroke-amber-500";
  if (severity === "unknown") return "stroke-muted-foreground";
  return "stroke-foreground";
};

const getBarColor = (percent, compacting) => {
  if (compacting) return "bg-muted-foreground/60";
  const severity = getUsageSeverity(percent);
  if (severity === "critical") return "bg-red-500";
  if (severity === "warning") return "bg-amber-500";
  if (severity === "unknown") return "bg-muted-foreground/40";
  return "bg-foreground";
};

const ContextDisplayContext = createContext(null);

function useContextDisplay() {
  const ctx = useContext(ContextDisplayContext);
  if (!ctx) throw new Error("ContextDisplay.* must be used within ContextDisplay.Root");
  return ctx;
}

function ContextDisplayRoot({ modelContextWindow, usage, compacting = false, children }) {
  const totalTokens = usage?.totalTokens ?? usage?.tokens ?? null;
  const percent = usage?.percent != null && Number.isFinite(usage.percent)
    ? usage.percent
    : (totalTokens != null && modelContextWindow > 0
      ? Math.min((totalTokens / modelContextWindow) * 100, 100)
      : null);

  const contextValue = useMemo(() => ({
    usage,
    totalTokens,
    percent,
    modelContextWindow,
    compacting,
    known: modelContextWindow > 0 && (percent != null || compacting),
  }), [usage, totalTokens, percent, modelContextWindow, compacting]);

  return <ContextDisplayContext.Provider value={contextValue}>
    <Tooltip>{children}</Tooltip>
  </ContextDisplayContext.Provider>;
}

function ContextDisplayTrigger({ className, children, ...props }) {
  return <TooltipTrigger asChild>
    <button
      type="button"
      data-slot="context-display-trigger"
      className={cn("inline-flex items-center rounded-md transition-colors", className)}
      {...props}
    >
      {children}
    </button>
  </TooltipTrigger>;
}

function ContextDisplayContent({ side = "top", className }) {
  const { usage, totalTokens, percent, modelContextWindow, compacting } = useContextDisplay();
  const last = usage?.lastRequestUsage;

  return <TooltipContent
    side={side}
    sideOffset={8}
    data-slot="context-display-popover"
    className={cn(
      "bg-popover text-popover-foreground w-56 rounded-lg border p-3 text-left shadow-md",
      className,
    )}
  >
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-6 whitespace-nowrap">
        <span className="font-medium">{compacting ? "Compacting context…" : "Context usage"}</span>
        <span className="text-muted-foreground tabular-nums">
          {compacting || percent == null
            ? "—"
            : `${formatTokenCount(totalTokens)} of ${formatTokenCount(modelContextWindow)}`}
        </span>
      </div>
      {!compacting && percent != null && <div className="bg-muted mt-2.5 h-1 overflow-hidden rounded-full">
        <div
          className={cn("h-full min-w-0 rounded-full transition-[width] duration-300", getBarColor(percent, compacting))}
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>}
      {percent != null && !compacting && <div className="mt-2 flex justify-between text-muted-foreground">
        <span>{Math.round(percent)}%</span>
        <span>Remaining {formatTokenCount(Math.max(0, modelContextWindow - (totalTokens || 0)))}</span>
      </div>}
      {last && <div className="mt-3 grid gap-1.5 border-t pt-2">
        <div className="font-medium">Last request</div>
        {[
          ["Input", last.input],
          ["Cached input", last.cacheRead],
          ["Output", last.output],
          ["Reasoning", last.reasoning],
        ].filter(([, value]) => value != null && value > 0).map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-6">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{formatTokenCount(value)}</span>
          </div>
        ))}
      </div>}
    </div>
  </TooltipContent>;
}

const RING_SIZE = 18;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function RingVisual() {
  const { percent, compacting } = useContextDisplay();
  const offset = compacting || percent == null
    ? RING_CIRCUMFERENCE * 0.75
    : RING_CIRCUMFERENCE - (Math.min(Math.max(percent, 0), 100) / 100) * RING_CIRCUMFERENCE;

  return <svg
    aria-hidden="true"
    width={RING_SIZE}
    height={RING_SIZE}
    viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
    className={cn("-rotate-90", compacting && "animate-spin")}
  >
    <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} className="stroke-muted" />
    <circle
      cx={RING_SIZE / 2}
      cy={RING_SIZE / 2}
      r={RING_RADIUS}
      fill="none"
      strokeWidth={RING_STROKE}
      strokeLinecap="round"
      strokeDasharray={RING_CIRCUMFERENCE}
      strokeDashoffset={offset}
      className={cn("transition-[stroke-dashoffset,stroke] duration-300", getStrokeColor(percent, compacting))}
    />
  </svg>;
}

function ContextDisplayRing({ modelContextWindow, usage, compacting, className, side = "top" }) {
  if (!modelContextWindow && !compacting) return null;
  const percent = usage?.percent;
  const known = compacting || (modelContextWindow > 0 && percent != null);
  if (!known && !compacting) return null;

  return <ContextDisplayRoot modelContextWindow={modelContextWindow || 1} usage={usage} compacting={compacting}>
    <ContextDisplayTrigger
      className={cn("text-muted-foreground hover:text-foreground gap-1.5 px-1.5 py-1 text-xs", className)}
      aria-label={compacting ? "Compacting context" : `Context usage ${percent != null ? `${Math.round(percent)}%` : "unknown"}`}
    >
      <RingVisual />
      {!compacting && percent != null && <span className="font-mono tabular-nums">{Math.round(percent)}%</span>}
    </ContextDisplayTrigger>
    <ContextDisplayContent side={side} />
  </ContextDisplayRoot>;
}

export const ContextDisplay = {
  Root: ContextDisplayRoot,
  Trigger: ContextDisplayTrigger,
  Content: ContextDisplayContent,
  Ring: ContextDisplayRing,
};

export { ContextDisplayRing, formatTokenCount, getUsageSeverity };
