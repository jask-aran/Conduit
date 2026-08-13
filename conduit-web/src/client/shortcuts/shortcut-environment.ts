import type {
  ShortcutBrowser, ShortcutDisplayMode, ShortcutEnvironment, ShortcutEnvironmentProvider, ShortcutPlatform,
} from "./shortcut-types.ts";

interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  standalone?: boolean;
  userAgentData?: { platform?: string; brands?: Array<{ brand: string; version: string }> };
}

type MatchMediaLike = (query: string) => { matches: boolean };

function detectPlatform(navigatorLike: NavigatorLike): ShortcutPlatform {
  const source = `${navigatorLike.userAgentData?.platform || ""} ${navigatorLike.platform || ""} ${navigatorLike.userAgent || ""}`.toLowerCase();
  if (source.includes("cros")) return "chromeos";
  if (source.includes("iphone") || source.includes("ipad") || source.includes("ipod")) return "ios";
  if (source.includes("android")) return "android";
  if (source.includes("mac")) return "macos";
  if (source.includes("win")) return "windows";
  if (source.includes("linux") || source.includes("x11")) return "linux";
  return "unknown";
}

function detectBrowser(navigatorLike: NavigatorLike): ShortcutBrowser {
  const brands = (navigatorLike.userAgentData?.brands || []).map((item) => item.brand.toLowerCase()).join(" ");
  const source = `${brands} ${navigatorLike.userAgent || ""}`.toLowerCase();
  if (source.includes("edg/") || source.includes("microsoft edge")) return "edge";
  if (source.includes("firefox/") || source.includes("fxios/")) return "firefox";
  if (source.includes("crios/") || source.includes("chrome/") || source.includes("google chrome")) return "chrome";
  if (source.includes("chromium")) return "chromium";
  if (source.includes("safari/") && !source.includes("chrome/") && !source.includes("crios/")) return "safari";
  return "unknown";
}

function detectDisplayMode(navigatorLike: NavigatorLike, matchMediaLike?: MatchMediaLike): ShortcutDisplayMode {
  if (navigatorLike.standalone || matchMediaLike?.("(display-mode: standalone)").matches) return "standalone";
  return "browser-tab";
}

export function detectShortcutEnvironment(
  navigatorLike: NavigatorLike = typeof navigator === "undefined" ? {} : navigator,
  matchMediaLike: MatchMediaLike | undefined = typeof matchMedia === "undefined" ? undefined : matchMedia,
): ShortcutEnvironment {
  return {
    platform: detectPlatform(navigatorLike),
    browser: detectBrowser(navigatorLike),
    displayMode: detectDisplayMode(navigatorLike, matchMediaLike),
  };
}

export function shortcutEnvironmentLabel(environment: ShortcutEnvironment): string {
  const browser = {
    chrome: "Chrome",
    edge: "Edge",
    firefox: "Firefox",
    safari: "Safari",
    chromium: "Chromium",
    unknown: "Unknown browser",
  }[environment.browser];
  const platform = {
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    chromeos: "ChromeOS",
    ios: "iOS",
    android: "Android",
    unknown: "Unknown system",
  }[environment.platform];
  return `${browser} · ${platform} · ${environment.displayMode === "standalone" ? "Installed app" : "Browser tab"}`;
}

export const browserShortcutEnvironmentProvider: ShortcutEnvironmentProvider = {
  detect: () => detectShortcutEnvironment(),
};
