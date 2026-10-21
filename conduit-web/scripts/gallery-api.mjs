import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

const slash = (value) => value.split(path.sep).join("/");
const parseSource = (source) => parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
  });
}

export function buildGalleryApi(root) {
  const src = path.resolve(root, "src");
  const ui = path.join(src, "components/ui");
  const components = {};
  for (const entry of fs.readdirSync(ui).sort()) {
    if (!/\.tsx?$/.test(entry) || entry === "index.tsx") continue;
    const filename = path.join(ui, entry);
    const source = fs.readFileSync(filename, "utf8");
    const body = parseSource(source).program.body;
    const text = (node) => source.slice(node.start, node.end).replace(/\s+/g, " ").trim();
    const doc = (node, blockOnly = false) => {
      const comment = node.leadingComments?.at(-1);
      if (!comment || (blockOnly && comment.type !== "CommentBlock") || source.slice(comment.end, node.start).trim()) return "";
      return comment.value.replace(/^\*/, "").split("\n").map((line) => line.replace(/^\s*\* ?/, "").trim()).join("\n").trim();
    };
    const declarations = new Map();
    for (const statement of body) {
      const node = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
      if (node?.type === "TSTypeAliasDeclaration" || node?.type === "TSInterfaceDeclaration") declarations.set(node.id.name, node);
    }
    const extract = (annotation, resolve = true) => {
      if (!annotation) return { props: [] };
      if (annotation.type === "TSTypeReference" && resolve && annotation.typeName.type === "Identifier") {
        const named = declarations.get(annotation.typeName.name);
        if (named?.type === "TSTypeAliasDeclaration") return extract(named.typeAnnotation, false);
        if (named?.type === "TSInterfaceDeclaration") {
          const result = extract(named.body, false);
          if (named.extends?.length) result.extends = named.extends.map(text).join(" & ");
          return result;
        }
      }
      if (annotation.type === "TSIntersectionType") {
        const props = [];
        const bases = [];
        for (const part of annotation.types) {
          const result = extract(part, resolve);
          props.push(...result.props);
          if (result.extends) bases.push(result.extends);
        }
        return { props, ...(bases.length ? { extends: bases.join(" & ") } : {}) };
      }
      if (annotation.type === "TSTypeLiteral" || annotation.type === "TSInterfaceBody") {
        return { props: (annotation.members ?? annotation.body).filter((member) => member.type === "TSPropertySignature" || member.type === "TSMethodSignature").map((member) => ({
          name: member.key.name ?? String(member.key.value ?? text(member.key)),
          type: member.type === "TSMethodSignature"
            ? `${member.typeParameters ? text(member.typeParameters) : ""}(${member.parameters.map(text).join(", ")}) => ${member.typeAnnotation ? text(member.typeAnnotation.typeAnnotation) : "void"}`
            : member.typeAnnotation ? text(member.typeAnnotation.typeAnnotation) : "unknown",
          optional: Boolean(member.optional),
          doc: doc(member),
        })) };
      }
      return { props: [], extends: text(annotation) };
    };
    for (const statement of body) {
      if (statement.type !== "ExportNamedDeclaration") continue;
      const declaration = statement.declaration;
      const candidates = declaration?.type === "FunctionDeclaration" ? [declaration]
        : declaration?.type === "VariableDeclaration" && declaration.kind === "const" ? declaration.declarations : [];
      for (const candidate of candidates) {
        const name = candidate.id?.name;
        const fn = candidate.type === "FunctionDeclaration" ? candidate : candidate.init;
        if (!name || !/^[A-Z]/.test(name) || !["FunctionDeclaration", "ArrowFunctionExpression", "FunctionExpression"].includes(fn?.type)) continue;
        const parameter = fn.params[0]?.type === "AssignmentPattern" ? fn.params[0].left : fn.params[0];
        const file = slash(path.relative(src, filename));
        const key = Object.hasOwn(components, name) ? `${file}#${name}` : name;
        components[key] = { name, file, line: statement.loc.start.line, doc: doc(statement, true), ...extract(parameter?.typeAnnotation?.typeAnnotation), usedIn: [] };
      }
    }
  }
  const byName = new Map();
  for (const component of Object.values(components)) {
    if (!byName.has(component.name)) byName.set(component.name, []);
    byName.get(component.name).push(component);
  }
  for (const filename of [...sourceFiles(path.join(src, "client")), ...sourceFiles(path.join(src, "components"))]) {
    if (filename.startsWith(`${ui}${path.sep}`)) continue;
    const source = fs.readFileSync(filename, "utf8");
    for (const statement of parseSource(source).program.body) {
      if (statement.type !== "ImportDeclaration") continue;
      const specifier = statement.source.value;
      const target = specifier.startsWith("@/") ? path.join(src, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : null;
      if (!target) continue;
      const base = target.replace(/\.[cm]?[jt]sx?$/, "").replace(/[/\\]index$/, "");
      if (base !== ui && !base.startsWith(`${ui}${path.sep}`)) continue;
      for (const imported of statement.specifiers) {
        if (imported.type !== "ImportSpecifier") continue;
        for (const component of byName.get(imported.imported.name ?? imported.imported.value) ?? []) {
          if (base !== ui && base !== path.join(src, component.file).replace(/\.tsx?$/, "")) continue;
          const file = slash(path.relative(src, filename));
          if (!component.usedIn.includes(file)) component.usedIn.push(file);
        }
      }
    }
  }
  for (const component of Object.values(components)) component.usedIn.sort();
  return { generated: new Date().toISOString(), components };
}
