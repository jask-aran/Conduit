import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const SOLID_COMPONENTS_PACKAGE = "@jask-aran/solid-components";
export const SOLID_COMPONENTS_MODES = new Set(["source", "preview"]);

function requireFile(file, description) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${description} is missing: ${file}`);
  }
}

export function resolveSolidComponents(root, mode) {
  if (!SOLID_COMPONENTS_MODES.has(mode)) {
    throw new Error(`Unsupported solid-components mode: ${mode}`);
  }

  const resolvedRoot = fs.realpathSync(root);
  const packageJsonPath = path.join(resolvedRoot, "package.json");
  requireFile(packageJsonPath, "solid-components package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.name !== SOLID_COMPONENTS_PACKAGE) {
    throw new Error(
      `Expected ${SOLID_COMPONENTS_PACKAGE} at ${resolvedRoot}, found ${packageJson.name ?? "an unnamed package"}.`,
    );
  }

  const base = mode === "source"
    ? path.join(resolvedRoot, "src", "meteor-shower")
    : path.join(resolvedRoot, "dist");
  const modulePath = mode === "source"
    ? path.join(base, "index.ts")
    : path.join(base, "meteor-shower", "index.js");
  const typesPath = mode === "source"
    ? modulePath
    : path.join(base, "meteor-shower", "index.d.ts");
  const cssPath = mode === "source"
    ? path.join(base, "meteor-shower.css")
    : path.join(base, "meteor-shower.css");

  requireFile(modulePath, "solid-components module");
  requireFile(typesPath, "solid-components declarations");
  requireFile(cssPath, "solid-components stylesheet");

  return {
    root: resolvedRoot,
    packageJson,
    modulePath,
    typesPath,
    cssPath,
    aliases: [
      { find: `${SOLID_COMPONENTS_PACKAGE}/meteor-shower.css`, replacement: cssPath },
      { find: `${SOLID_COMPONENTS_PACKAGE}/meteor-shower`, replacement: modulePath },
      { find: SOLID_COMPONENTS_PACKAGE, replacement: modulePath },
    ],
  };
}

export function solidComponentsViteOptions(env = process.env) {
  const mode = env.CONDUIT_SOLID_COMPONENTS_MODE;
  const root = env.CONDUIT_SOLID_COMPONENTS_ROOT;
  if (!mode && !root) return null;
  if (!mode || !root) {
    throw new Error(
      "CONDUIT_SOLID_COMPONENTS_MODE and CONDUIT_SOLID_COMPONENTS_ROOT must be set together.",
    );
  }
  return resolveSolidComponents(root, mode);
}

export async function hashDirectory(root) {
  const digest = createHash("sha256");

  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        digest.update(relative);
        digest.update("\0");
        digest.update(await fsp.readFile(absolute));
        digest.update("\0");
      }
    }
  }

  await visit(root);
  return digest.digest("hex");
}

export function localTypeScriptConfig({ conduitWebRoot, resolution }) {
  return {
    extends: path.join(conduitWebRoot, "tsconfig.json"),
    compilerOptions: {
      paths: {
        "@/*": [path.join(conduitWebRoot, "src", "*")],
        [SOLID_COMPONENTS_PACKAGE]: [resolution.typesPath],
        [`${SOLID_COMPONENTS_PACKAGE}/meteor-shower`]: [resolution.typesPath],
      },
    },
    include: [
      path.join(conduitWebRoot, "src", "client", "**", "*.ts"),
      path.join(conduitWebRoot, "src", "client", "**", "*.tsx"),
      path.join(conduitWebRoot, "src", "components", "**", "*.ts"),
      path.join(conduitWebRoot, "src", "components", "**", "*.tsx"),
    ],
  };
}
