import { FileIcon } from "lucide-solid";
import { Show } from "solid-js";

type FileIconKind =
  | "c"
  | "cpp"
  | "csharp"
  | "css"
  | "docker"
  | "env"
  | "git"
  | "go"
  | "html"
  | "image"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "lock"
  | "markdown"
  | "notebook"
  | "php"
  | "python"
  | "ruby"
  | "rust"
  | "shell"
  | "sql"
  | "svelte"
  | "swift"
  | "toml"
  | "typescript"
  | "vue"
  | "yaml";

const iconLabels = {
  c: "C",
  cpp: "C+",
  csharp: "C#",
  css: "#",
  docker: "D",
  env: "E",
  git: "G",
  go: "GO",
  html: "<>",
  image: "◆",
  java: "J",
  javascript: "JS",
  json: "{}",
  kotlin: "K",
  lock: "⌁",
  markdown: "M",
  notebook: "J",
  php: "P",
  python: "PY",
  ruby: "RB",
  rust: "RS",
  shell: ">_",
  sql: "DB",
  svelte: "S",
  swift: "SW",
  toml: "T",
  typescript: "TS",
  vue: "V",
  yaml: "Y",
} satisfies Record<FileIconKind, string>;

const extensionKinds: Record<string, FileIconKind> = {
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  gif: "image",
  go: "go",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ipynb: "notebook",
  jpeg: "image",
  jpg: "image",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  lock: "lock",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  php: "php",
  png: "image",
  py: "python",
  pyw: "python",
  rb: "ruby",
  rs: "rust",
  sass: "css",
  scss: "css",
  sh: "shell",
  sql: "sql",
  svelte: "svelte",
  svg: "image",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  vue: "vue",
  webp: "image",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

function fileIconKind(name: string): FileIconKind | null {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";
  if (lower === "makefile") return "shell";
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules") return "git";
  if (lower === ".env" || lower.startsWith(".env.")) return "env";
  if (lower === ".python-version" || lower === "pyproject.toml") return "python";
  if (lower === "package-lock.json" || lower === "pnpm-lock.yaml" || lower === "uv.lock" || lower === "yarn.lock") return "lock";
  if (lower === "package.json") return "javascript";
  if (lower.startsWith("tsconfig") && lower.endsWith(".json")) return "typescript";
  const separator = lower.lastIndexOf(".");
  return extensionKinds[separator >= 0 ? lower.slice(separator + 1) : ""] || null;
}

const highlightLanguages: Partial<Record<FileIconKind, string>> = {
  c: "cpp",
  cpp: "cpp",
  csharp: "csharp",
  css: "css",
  docker: "dockerfile",
  env: "bash",
  git: "bash",
  go: "go",
  html: "xml",
  java: "java",
  javascript: "javascript",
  json: "json",
  markdown: "markdown",
  notebook: "json",
  php: "php",
  python: "python",
  ruby: "ruby",
  rust: "rust",
  shell: "bash",
  sql: "sql",
  svelte: "xml",
  typescript: "typescript",
  vue: "xml",
  yaml: "yaml",
};

export function fileHighlightLanguage(name: string) {
  const extension = name.toLowerCase().split(".").at(-1);
  if (extension === "json" || extension === "jsonc") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  const kind = fileIconKind(name);
  return kind ? highlightLanguages[kind] || "" : "";
}

export function FileTypeIcon(props: { name: string }) {
  const kind = () => fileIconKind(props.name);
  return <Show when={kind()} fallback={<FileIcon class="workspace-file-icon-generic" aria-hidden="true" />}>
    {(value) => <span class="workspace-file-icon" data-kind={value()} aria-hidden="true">{iconLabels[value()]}</span>}
  </Show>;
}
