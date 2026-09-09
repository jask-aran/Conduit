import { LanguageDescription, LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

function legacyLanguage(parser: StreamParser<unknown>) {
  return new LanguageSupport(StreamLanguage.define(parser));
}

export const workspaceLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: "C/C++",
    alias: ["c", "cpp"],
    extensions: ["c", "h", "cc", "cpp", "cxx", "hh", "hpp", "hxx", "ino"],
    load: () => import("@codemirror/lang-cpp").then(({ cpp }) => cpp()),
  }),
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then(({ css }) => css()),
  }),
  LanguageDescription.of({
    name: "Go",
    extensions: ["go"],
    load: () => import("@codemirror/lang-go").then(({ go }) => go()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["xhtml"],
    extensions: ["html", "htm", "handlebars", "hbs"],
    load: () => import("@codemirror/lang-html").then(({ html }) => html()),
  }),
  LanguageDescription.of({
    name: "Java",
    extensions: ["java"],
    load: () => import("@codemirror/lang-java").then(({ java }) => java()),
  }),
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["ecmascript", "js", "node"],
    extensions: ["js", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript()),
  }),
  LanguageDescription.of({
    name: "JSX",
    extensions: ["jsx"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    extensions: ["ts", "mts", "cts"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "TSX",
    extensions: ["tsx"],
    load: () => import("@codemirror/lang-javascript").then(({ javascript }) => javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["jsonc", "json5"],
    extensions: ["json", "jsonc", "json5", "map", "code-workspace"],
    load: () => import("@codemirror/lang-json").then(({ json }) => json()),
  }),
  LanguageDescription.of({
    name: "PHP",
    extensions: ["php", "php3", "php4", "php5", "php7", "phtml"],
    load: () => import("@codemirror/lang-php").then(({ php }) => php()),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py"],
    extensions: ["py", "pyw", "bzl"],
    filename: /^(?:BUCK|BUILD)$/,
    load: () => import("@codemirror/lang-python").then(({ python }) => python()),
  }),
  LanguageDescription.of({
    name: "Rust",
    extensions: ["rs"],
    load: () => import("@codemirror/lang-rust").then(({ rust }) => rust()),
  }),
  LanguageDescription.of({
    name: "SCSS",
    extensions: ["scss"],
    load: () => import("@codemirror/lang-sass").then(({ sass }) => sass()),
  }),
  LanguageDescription.of({
    name: "Sass",
    extensions: ["sass"],
    load: () => import("@codemirror/lang-sass").then(({ sass }) => sass({ indented: true })),
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load: () => import("@codemirror/lang-sql").then(({ sql }) => sql()),
  }),
  LanguageDescription.of({
    name: "Vue",
    extensions: ["vue"],
    load: () => import("@codemirror/lang-vue").then(({ vue }) => vue()),
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["rss", "svg"],
    extensions: ["xml", "xsl", "xsd", "svg"],
    load: () => import("@codemirror/lang-xml").then(({ xml }) => xml()),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    load: () => import("@codemirror/lang-yaml").then(({ yaml }) => yaml()),
  }),
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash", "sh", "zsh"],
    extensions: ["sh", "bash", "zsh"],
    filename: /^(?:\.bashrc|\.profile|\.zshrc)$/,
    load: () => import("@codemirror/legacy-modes/mode/shell").then(({ shell }) => legacyLanguage(shell)),
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    load: () => import("@codemirror/legacy-modes/mode/toml").then(({ toml }) => legacyLanguage(toml)),
  }),
  LanguageDescription.of({
    name: "Dockerfile",
    filename: /^(?:Dockerfile|Containerfile)(?:\..+)?$/i,
    load: () => import("@codemirror/legacy-modes/mode/dockerfile").then(({ dockerFile }) => legacyLanguage(dockerFile)),
  }),
];

export function workspaceLanguageForFilename(path: string) {
  return LanguageDescription.matchFilename(workspaceLanguages, path);
}

export function workspaceLanguageForName(name: string) {
  return LanguageDescription.matchLanguageName(workspaceLanguages, name, false);
}
