import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Typed device capabilities (plan decision 7, milestone 4): things a device
 * can do that are not files or a shell, each granted on its own by the
 * device's owner. The catalogue is Conduit's, the same on every device; what
 * a device offers is what its platform can do here, and of that what was
 * granted. The agent sees each as an ordinary tool (src/server/device-capabilities.js).
 *
 * A capability runs as this device's user through the platform's own
 * commands; nothing is installed. On WSL the Windows side's are used, since
 * that is the desktop the person sees.
 */
export const CAPABILITIES = {
  notify: { label: "Notifications", description: "Show a notification on this device" },
  "clipboard-read": { label: "Read the clipboard", description: "Read the text on this device's clipboard" },
  "clipboard-write": { label: "Write the clipboard", description: "Put text on this device's clipboard" },
};

const isWsl = () => process.platform === "linux"
  && /microsoft/i.test((() => { try { return fs.readFileSync("/proc/version", "utf8"); } catch { return ""; } })());

/** A command on PATH, or null. */
function which(name) {
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
    }
  }
  return null;
}

function run(command, args, { input = null, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 500)));
      else resolve(String(stdout));
    });
    if (input != null) child.stdin.end(input);
  });
}

// A PowerShell script with its data passed as base64, never spliced into the source.
const powershell = (shell, script, data = {}) => run(shell, ["-NoProfile", "-NonInteractive", "-Command",
  `$d = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(data)).toString("base64")}')) | ConvertFrom-Json; ${script}`]);

// Windows' own toast, under PowerShell's app id: no module to install.
const TOAST = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode($d.title)) | Out-Null; $t.Item(1).AppendChild($x.CreateTextNode($d.body)) | Out-Null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;

/** What this device's platform can do: capability id -> implementation. */
export function platformCapabilities() {
  const found = {};
  const windows = process.platform === "win32" ? which("powershell") : isWsl() ? which("powershell.exe") : null;
  if (windows) {
    found.notify = ({ title, body }) => powershell(windows, TOAST, { title, body });
    found["clipboard-read"] = async () => (await powershell(windows, "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw")).replace(/\r?\n$/, "");
    found["clipboard-write"] = ({ text }) => powershell(windows, "Set-Clipboard -Value $d.text", { text });
    return found;
  }
  if (process.platform === "darwin") {
    found.notify = ({ title, body }) => run("osascript", ["-e", "on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run", title, body]);
    found["clipboard-read"] = () => run("pbpaste", []);
    found["clipboard-write"] = ({ text }) => run("pbcopy", [], { input: text });
    return found;
  }
  // Linux with a desktop session: notify-send, and Wayland's or X11's clipboard tools.
  const desktop = Boolean(process.env.WAYLAND_DISPLAY || process.env.DISPLAY);
  if (desktop && which("notify-send")) found.notify = ({ title, body }) => run("notify-send", ["--", title, body]);
  if (process.env.WAYLAND_DISPLAY && which("wl-paste") && which("wl-copy")) {
    found["clipboard-read"] = () => run("wl-paste", ["--no-newline"]);
    found["clipboard-write"] = ({ text }) => run("wl-copy", [], { input: text });
  } else if (process.env.DISPLAY && which("xclip")) {
    found["clipboard-read"] = () => run("xclip", ["-selection", "clipboard", "-o"]);
    found["clipboard-write"] = ({ text }) => run("xclip", ["-selection", "clipboard"], { input: text });
  }
  return found;
}

/** The capability call's arguments, checked: what each takes, as strings, bounded. */
export function capabilityArgs(id, args) {
  const text = (value, max) => String(value ?? "").slice(0, max);
  if (id === "notify") return { title: text(args?.title, 200) || "Conduit", body: text(args?.body, 2000) };
  if (id === "clipboard-write") return { text: text(args?.text, 1024 * 1024) };
  return {};
}

/**
 * This device's capabilities as main sees them: every one its platform has,
 * with whether its owner granted it. `granted` is the pairing's list.
 */
export function capabilityViews(available, granted = []) {
  return Object.keys(available).filter((id) => CAPABILITIES[id])
    .map((id) => ({ id, label: CAPABILITIES[id].label, granted: granted.includes(id) }));
}
