import { IDENTITY_COLOURS } from "@/components/ui/palettes";
import { Glyph } from "@/components/ui";
import {
  ActivityIcon,
  ApertureIcon,
  AtomIcon,
  AwardIcon,
  BadgeCheckIcon,
  BellIcon,
  BookOpenIcon,
  BriefcaseBusinessIcon,
  BoxesIcon,
  BracesIcon,
  Building2Icon,
  BugIcon,
  CalendarDaysIcon,
  CameraIcon,
  ChartNoAxesCombinedIcon,
  CodeIcon,
  ComponentIcon,
  CpuIcon,
  DatabaseIcon,
  FolderGit2Icon,
  GaugeIcon,
  FlameIcon,
  GitBranchIcon,
  GlobeIcon,
  GraduationCapIcon,
  Layers2Icon,
  LayersIcon,
  LightbulbIcon,
  MapIcon,
  PaletteIcon,
  PuzzleIcon,
  RocketIcon,
  RouteIcon,
  ServerCogIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  TerminalIcon,
  WorkflowIcon,
  ZapIcon,
} from "lucide-solid";
import type { WorkspaceAppearance } from "../api/contracts";

export const DEFAULT_WORKSPACE_APPEARANCE: WorkspaceAppearance = {
  mode: "icon",
  value: "boxes",
  color: "mauve",
};

export const WORKSPACE_ICON_OPTIONS = [
  { id: "activity", label: "Activity", component: ActivityIcon },
  { id: "aperture", label: "Aperture", component: ApertureIcon },
  { id: "atom", label: "Atom", component: AtomIcon },
  { id: "award", label: "Award", component: AwardIcon },
  { id: "badge-check", label: "Badge check", component: BadgeCheckIcon },
  { id: "bell", label: "Bell", component: BellIcon },
  { id: "book-open", label: "Book", component: BookOpenIcon },
  { id: "briefcase-business", label: "Briefcase", component: BriefcaseBusinessIcon },
  { id: "boxes", label: "Boxes", component: BoxesIcon },
  { id: "braces", label: "Braces", component: BracesIcon },
  { id: "building-2", label: "Building", component: Building2Icon },
  { id: "bug", label: "Bug", component: BugIcon },
  { id: "calendar-days", label: "Calendar", component: CalendarDaysIcon },
  { id: "camera", label: "Camera", component: CameraIcon },
  { id: "chart-no-axes-combined", label: "Chart", component: ChartNoAxesCombinedIcon },
  { id: "code", label: "Code", component: CodeIcon },
  { id: "component", label: "Component", component: ComponentIcon },
  { id: "cpu", label: "CPU", component: CpuIcon },
  { id: "database", label: "Database", component: DatabaseIcon },
  { id: "folder-git-2", label: "Folder", component: FolderGit2Icon },
  { id: "flame", label: "Flame", component: FlameIcon },
  { id: "gauge", label: "Gauge", component: GaugeIcon },
  { id: "git-branch", label: "Git branch", component: GitBranchIcon },
  { id: "globe", label: "Globe", component: GlobeIcon },
  { id: "graduation-cap", label: "Graduation cap", component: GraduationCapIcon },
  { id: "layers", label: "Layers", component: LayersIcon },
  { id: "layers-2", label: "Layers 2", component: Layers2Icon },
  { id: "lightbulb", label: "Lightbulb", component: LightbulbIcon },
  { id: "map", label: "Map", component: MapIcon },
  { id: "palette", label: "Palette", component: PaletteIcon },
  { id: "puzzle", label: "Puzzle", component: PuzzleIcon },
  { id: "rocket", label: "Rocket", component: RocketIcon },
  { id: "route", label: "Route", component: RouteIcon },
  { id: "server-cog", label: "Server", component: ServerCogIcon },
  { id: "shield-check", label: "Shield", component: ShieldCheckIcon },
  { id: "sparkles", label: "Sparkles", component: SparklesIcon },
  { id: "star", label: "Star", component: StarIcon },
  { id: "terminal", label: "Terminal", component: TerminalIcon },
  { id: "workflow", label: "Workflow", component: WorkflowIcon },
  { id: "zap", label: "Zap", component: ZapIcon },
] as const;

export const WORKSPACE_COLOR_OPTIONS = IDENTITY_COLOURS;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function workspaceIconOption(value?: string) {
  return WORKSPACE_ICON_OPTIONS.find((option) => option.id === value)
    || WORKSPACE_ICON_OPTIONS.find((option) => option.id === DEFAULT_WORKSPACE_APPEARANCE.value)
    || WORKSPACE_ICON_OPTIONS[0];
}

export function workspaceColorOption(value?: string) {
  const normalized = String(value || "").trim().toLowerCase();
  return WORKSPACE_COLOR_OPTIONS.find((option) => option.id === normalized)
    || (HEX_COLOR.test(normalized) ? { id: normalized, label: normalized, hex: normalized } : WORKSPACE_COLOR_OPTIONS[3]);
}

export function normalizeWorkspaceAppearance(value?: WorkspaceAppearance | null): WorkspaceAppearance {
  const color = workspaceColorOption(value?.color).id;
  if (value?.mode === "monogram") {
    const monogram = [...String(value.value || "").trim()].slice(0, 2).join("");
    if (monogram) return { mode: "monogram", value: monogram, color };
  }
  return { mode: "icon", value: workspaceIconOption(value?.value).id, color };
}

export function WorkspaceGlyph(props: { appearance?: WorkspaceAppearance | null; class?: string }) {
  const appearance = () => normalizeWorkspaceAppearance(props.appearance);
  const color = () => workspaceColorOption(appearance().color);
  const icon = () => workspaceIconOption(appearance().value);
  return <Glyph icon={icon().component} monogram={appearance().mode === "monogram" ? appearance().value : undefined}
    colour={color().hex} class={props.class} value={appearance().value} />;
}
