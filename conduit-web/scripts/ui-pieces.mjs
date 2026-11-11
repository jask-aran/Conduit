// The piece names (virtual:ui-pieces): which library piece draws an element, read from the library's source so it
// cannot fall behind it. A piece whose root has no `ui-*` class of its own says its name with `data-piece="Name"`.
//
//   node scripts/ui-pieces.mjs    print the pieces with no name in the page, and classes two pieces claim
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

const FLOW = new Set(["Show", "For", "Index", "Switch", "Match", "Portal", "Suspense", "ErrorBoundary", "Later"]);
const ANCHORS = ["data-region"];

const walk = (node, visit) => {
  if (!node || typeof node.type !== "string") return;
  if (visit(node) === false) return;
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value.type === "string") walk(value, visit);
  }
};
const tagName = (name) => name.type === "JSXIdentifier" ? name.name : name.type === "JSXMemberExpression" ? `${tagName(name.object)}.${name.property.name}` : "";
const strings = (node) => { const found = []; walk(node, (inner) => { if (inner.type === "StringLiteral") found.push(inner.value); else if (inner.type === "TemplateElement") found.push(inner.value.cooked ?? ""); }); return found; };
const classes = (element) => {
  const attribute = element.attributes.find((candidate) => candidate.type === "JSXAttribute" && candidate.name.name === "class");
  return attribute?.value ? strings(attribute.value).flatMap((text) => text.match(/(?<![\w-])ui-[a-z0-9-]+(?![\w-])/g) ?? []) : [];
};
const literal = (element, name) => {
  const value = element.attributes.find((candidate) => candidate.type === "JSXAttribute" && candidate.name.name === name)?.value;
  return value?.type === "StringLiteral" ? value.value : null;
};
// A wrapper that draws nothing of its own: control flow, a context provider, a Kobalte part with no class and no `as`.
const transparent = (element) => {
  const tag = tagName(element.name);
  if (FLOW.has(tag) || tag.endsWith(".Provider")) return true;
  return tag.includes(".") && !/^Icons\./.test(tag) && !classes(element).length && !element.attributes.some((attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "as");
};
function rootOf(fn) {
  const returns = [];
  if (fn.body.type !== "BlockStatement") returns.push(fn.body);
  else walk(fn.body, (node) => {
    if (/Function/.test(node.type)) return false;
    if (node.type === "ReturnStatement" && node.argument) returns.push(node.argument);
  });
  const down = (node) => {
    if (!node) return null;
    if (node.type === "JSXElement") return transparent(node.openingElement) ? firstChild(node) : node.openingElement;
    if (node.type === "JSXFragment") return node.children.filter((child) => child.type === "JSXElement").length > 1 ? null : firstChild(node);
    if (node.type === "JSXExpressionContainer" || node.type === "ParenthesizedExpression" || node.type === "TSAsExpression") return down(node.expression);
    if (node.type === "ConditionalExpression") return down(node.consequent) ?? down(node.alternate);
    if (node.type === "LogicalExpression") return down(node.right);
    if (node.type === "ArrowFunctionExpression") return node.body.type === "BlockStatement" ? null : down(node.body);
    return null;
  };
  const firstChild = (node) => { for (const child of node.children) { const found = down(child); if (found) return found; } return null; };
  for (const expression of returns.reverse()) { const found = down(expression); if (found) return found; }
  return null;
}
const sources = (directory) => fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? sources(file) : /\.tsx$/.test(entry.name) ? [file] : [];
});

export function buildUiPieces(root) {
  const repo = path.resolve(root, "..");
  const rel = (file) => path.relative(repo, file).split(path.sep).join("/");
  const ui = path.join(root, "src/components/ui");
  const pieces = {};
  const claims = new Map();
  const claim = (name, piece, root) => claims.set(name, [...(claims.get(name) ?? []), { piece, root }]);
  for (const file of fs.readdirSync(ui).sort().filter((entry) => entry.endsWith(".tsx") && entry !== "index.tsx").map((entry) => path.join(ui, entry))) {
    const program = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }).program;
    // `import { Menu as Surface }`: a root drawn through Surface is drawn through Menu.
    const alias = new Map(program.body.filter((statement) => statement.type === "ImportDeclaration").flatMap((statement) => statement.specifiers)
      .filter((specifier) => specifier.type === "ImportSpecifier" && specifier.imported.name !== specifier.local.name).map((specifier) => [specifier.local.name, specifier.imported.name]));
    for (const statement of program.body) {
      const exported = statement.type === "ExportNamedDeclaration";
      const declaration = exported ? statement.declaration : statement;
      const candidates = declaration?.type === "FunctionDeclaration" ? [declaration] : declaration?.type === "VariableDeclaration" ? declaration.declarations : [];
      for (const candidate of candidates) {
        const name = candidate.id?.name;
        const body = candidate.type === "FunctionDeclaration" ? candidate : candidate.init;
        if (!name || !/^[A-Z][a-zA-Z0-9]*$/.test(name) || !body || !["FunctionDeclaration", "ArrowFunctionExpression", "FunctionExpression"].includes(body.type)) continue;
        const elements = [];
        walk(body, (node) => { if (node.type === "JSXElement") elements.push(node.openingElement); });
        if (!elements.length) continue;
        const rootElement = rootOf(body);
        const tag = rootElement ? tagName(rootElement.name) : "";
        const own = rootElement ? classes(rootElement)[0] ?? null : null;
        const said = elements.map((element) => literal(element, "data-piece")).find((value) => value === name) ?? null;
        // Drawn through another piece: the root itself, or what a Kobalte root is told to draw as.
        const as = rootElement?.attributes.find((attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "as")?.value?.expression;
        const through = as?.type === "Identifier" ? as.name : /^[A-Z][a-zA-Z0-9]*$/.test(tag) ? tag : null;
        pieces[name] = { file: rel(file), line: candidate.loc.start.line, exported, class: own, said: Boolean(said), wraps: through ? alias.get(through) ?? through : null,
          draws: /^[a-z]|^Dynamic$/.test(tag) };
        if (own) claim(own, name, true);
        // Every other ui-* word it writes is a part of it (a class given to an engine as a string included).
        for (const part of strings(body).flatMap((text) => text.match(/(?<![\w-])ui-[a-z0-9-]+(?![\w-])/g) ?? [])) if (part !== own) claim(part, name, false);
      }
    }
  }
  for (const file of fs.readdirSync(ui).filter((entry) => /\.tsx?$/.test(entry)).map((entry) => path.join(ui, entry))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/dataset\.piece = "(\w+)"/g)) pieces[match[1]] ??= { file: rel(file), line: text.slice(0, match.index).split("\n").length, exported: true, class: null, said: true, wraps: null, draws: true };
  }
  const classMap = {};
  const shared = [];
  for (const [name, claimed] of claims) {
    const roots = claimed.filter((entry) => entry.root);
    if (roots.length > 1) shared.push(`${name}: ${roots.map((entry) => entry.piece).join(", ")}`);
    classMap[name] = roots.length ? { piece: roots[0].piece, ...(roots.length > 1 ? { also: roots.slice(1).map((entry) => entry.piece) } : {}) } : { piece: claimed[0].piece, part: true };
  }
  const styles = {};
  const stylesDir = path.join(ui, "styles");
  const sheets = fs.readdirSync(stylesDir).filter((entry) => entry.endsWith(".css")).sort().map((entry) => [rel(path.join(stylesDir, entry)), fs.readFileSync(path.join(stylesDir, entry), "utf8")]);
  for (const [name, entry] of Object.entries(classMap)) {
    const family = path.basename(pieces[entry.piece]?.file ?? "", ".tsx");
    const ordered = [...sheets.filter(([file]) => path.basename(file, ".css") === family), ...sheets.filter(([file]) => path.basename(file, ".css") !== family)];
    for (const rule of [new RegExp(`^\\.${name}(?![\\w-])`, "m"), new RegExp(`\\.${name}(?![\\w-])`)]) {
      const found = ordered.filter(([, text]) => rule.test(text)).slice(0, rule.multiline ? 8 : 1).map(([file, text]) => `${file}:${text.slice(0, text.search(rule)).split("\n").length}`);
      if (found.length) { styles[name] = found; break; }
    }
  }
  const anchors = {};
  for (const file of sources(path.join(root, "src/client")).concat(sources(path.join(root, "src/components")))) {
    const text = fs.readFileSync(file, "utf8");
    for (const attribute of ANCHORS) for (const match of text.matchAll(new RegExp(`${attribute}="([\\w:-]+)"`, "g")))
      anchors[`${attribute}=${match[1]}`] ??= `${rel(file)}:${text.slice(0, match.index).split("\n").length}`;
  }
  const unnamed = Object.keys(pieces).filter((name) => pieces[name].exported && pieces[name].draws && !pieces[name].class && !pieces[name].said);
  const through = {};
  for (const [name, piece] of Object.entries(pieces)) if (!piece.class && !piece.said && piece.wraps && pieces[piece.wraps]) (through[piece.wraps] ??= []).push(name);
  return { pieces: Object.fromEntries(Object.entries(pieces).map(([name, piece]) => [name, { source: `${piece.file}:${piece.line}`, ...(piece.wraps && pieces[piece.wraps] ? { wraps: piece.wraps } : {}), ...(through[name] ? { through: through[name] } : {}) }])),
    classes: classMap, styles, anchors, unnamed, shared };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const built = buildUiPieces(path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."));
  console.log(`${Object.keys(built.pieces).length} pieces, ${Object.keys(built.classes).length} classes, ${Object.keys(built.anchors).length} anchors`);
  console.log(`No name in the page (${built.unnamed.length}):\n  ${built.unnamed.map((name) => `${name}  ${built.pieces[name].source}`).join("\n  ")}`);
  console.log(`Root class claimed twice (${built.shared.length}):\n  ${built.shared.join("\n  ")}`);
}
