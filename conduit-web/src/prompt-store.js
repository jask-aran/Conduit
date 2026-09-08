import fs from "node:fs/promises";
import path from "node:path";

const MAX_PROMPT_BYTES = 128 * 1024;
const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;

export class PromptStore {
  constructor({ root, prompts }) {
    this.root = path.resolve(root);
    this.prompts = new Map(prompts.map((prompt) => [prompt.id, { ...prompt, defaultPath: path.resolve(prompt.defaultPath) }]));
  }

  prompt(id) {
    if (!SAFE_ID.test(String(id || "")) || !this.prompts.has(id)) {
      throw Object.assign(new Error("Unknown prompt"), { code: "unknown_prompt", status: 404 });
    }
    return this.prompts.get(id);
  }

  overridePath(id) {
    this.prompt(id);
    return path.join(this.root, `${id}.md`);
  }

  async hasOverride(id) {
    try { return (await fs.stat(this.overridePath(id))).isFile(); }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }

  async pathFor(id) {
    return await this.hasOverride(id) ? this.overridePath(id) : this.prompt(id).defaultPath;
  }

  async read(id) {
    const prompt = this.prompt(id);
    const modified = await this.hasOverride(id);
    const content = await fs.readFile(modified ? this.overridePath(id) : prompt.defaultPath, "utf8");
    return { id: prompt.id, label: prompt.label, kind: prompt.kind, content, modified };
  }

  async list() {
    return Promise.all([...this.prompts.keys()].map((id) => this.read(id)));
  }

  async save(id, content) {
    this.prompt(id);
    if (typeof content !== "string" || !content.trim()) {
      throw Object.assign(new Error("Prompt content is required"), { code: "prompt_required", status: 400 });
    }
    if (Buffer.byteLength(content, "utf8") > MAX_PROMPT_BYTES) {
      throw Object.assign(new Error("Prompt exceeds 128 KiB"), { code: "prompt_too_large", status: 413 });
    }
    await fs.mkdir(this.root, { recursive: true });
    const target = this.overridePath(id);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, target);
    return this.read(id);
  }

  async reset(id) {
    this.prompt(id);
    await fs.rm(this.overridePath(id), { force: true });
    return this.read(id);
  }
}
