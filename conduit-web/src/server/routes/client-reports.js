import fs from "node:fs/promises";
import path from "node:path";

const KINDS = new Set(["stray-frost"]);
const KEEP = 200;

export function registerClientReportRoutes(app, { dataRoot }) {
  const folder = path.join(dataRoot, "client-reports");
  let writing = Promise.resolve();
  app.post("/v0/client-reports/:kind", (request, response) => {
    const kind = request.params.kind;
    if (!KINDS.has(kind)) return response.status(404).json({ error: "unknown_report" });
    const line = JSON.stringify({ at: new Date().toISOString(), agent: String(request.get("user-agent") || "").slice(0, 200), ...request.body });
    if (line.length > 64_000) return response.status(413).json({ error: "report_too_large" });
    writing = writing.then(async () => {
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(folder, `${kind}.jsonl`);
      const kept = (await fs.readFile(file, "utf8").catch(() => "")).split("\n").filter(Boolean).slice(-(KEEP - 1));
      await fs.writeFile(file, `${[...kept, line].join("\n")}\n`);
    }).catch((error) => console.warn("[client-reports] could not save a report", error.message));
    response.status(202).json({ ok: true });
  });
}
