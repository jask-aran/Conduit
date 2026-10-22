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
  // The library, then the behaviour adapters beside it (components/*.tsx: Menu, Select, Dialog… wrapping the
  // library's pieces); an adapter named as a library piece is keyed "components/<file>#<Name>".
  const adapters = path.join(src, "components");
  const files = [ui, adapters].flatMap((directory) => fs.readdirSync(directory).sort()
    .filter((entry) => /\.tsx?$/.test(entry) && entry !== "index.tsx").map((entry) => path.join(directory, entry)));
  const components = {};
  for (const filename of files) {
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
      // ParentProps<T> (solid-js): T's props and children.
      if (annotation.type === "TSTypeReference" && annotation.typeName.type === "Identifier" && annotation.typeName.name === "ParentProps" && annotation.typeParameters?.params.length === 1) {
        const result = extract(annotation.typeParameters.params[0], resolve);
        return { ...result, props: [...result.props, { name: "children", type: "JSX.Element", optional: true, doc: "" }] };
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
        const init = candidate.type === "FunctionDeclaration" ? candidate : candidate.init;
        // Object.assign(component, { parts }): the component is the first argument.
        const fn = init?.type === "CallExpression" && init.callee.type === "MemberExpression" && init.callee.object.name === "Object" && init.callee.property.name === "assign" ? init.arguments[0] : init;
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
  // Every app source (the client, the server-rendered pages, the adapters), not the library itself or the gallery.
  const gallery = path.join(src, "gallery");
  for (const filename of sourceFiles(src)) {
    if (filename.startsWith(`${ui}${path.sep}`) || filename.startsWith(`${gallery}${path.sep}`) || filename.endsWith(".d.ts")) continue;
    const source = fs.readFileSync(filename, "utf8");
    for (const statement of parseSource(source).program.body) {
      if (statement.type !== "ImportDeclaration") continue;
      const specifier = statement.source.value;
      const target = specifier.startsWith("@/") ? path.join(src, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : null;
      if (!target) continue;
      const base = target.replace(/\.[cm]?[jt]sx?$/, "").replace(/[/\\]index$/, "");
      if (!base.startsWith(`${adapters}${path.sep}`)) continue;
      for (const imported of statement.specifiers) {
        if (imported.type !== "ImportSpecifier") continue;
        for (const component of byName.get(imported.imported.name ?? imported.imported.value) ?? []) {
          const own = path.join(src, component.file).replace(/\.tsx?$/, "");
          if (base !== own && !(base === ui && own.startsWith(`${ui}${path.sep}`))) continue;
          const file = slash(path.relative(src, filename));
          if (!component.usedIn.includes(file)) component.usedIn.push(file);
        }
      }
    }
  }
  for (const component of Object.values(components)) component.usedIn.sort();
  return { generated: new Date().toISOString(), components };
}
