import { appendFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const pattern = /^approvals-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const warn = (error) => console.warn("pi-durable-approver audit:", error);

/** Queue JSONL writes; audit failures never escape to the caller. */
export function jsonlAudit(dir, { keepDays = 30 } = {}) {
  let chain = Promise.resolve();
  let first = true;
  return (record) => {
    let line;
    let date;
    try {
      line = JSON.stringify(record) + "\n";
      date = new Date(record.at).toISOString().slice(0, 10);
    } catch (error) { warn(error); return; }
    chain = chain.then(async () => {
      await mkdir(dir, { recursive: true });
      if (first) {
        first = false;
        const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
        for (const file of await readdir(dir)) {
          const match = pattern.exec(file);
          if (match && match[1] < cutoff) {
            try { await unlink(join(dir, file)); } catch (error) { warn(error); }
          }
        }
      }
      await appendFile(join(dir, `approvals-${date}.jsonl`), line);
    }).catch(warn);
  };
}

export async function readAudit(dir, { limit = 50 } = {}) {
  const records = [];
  if (!(limit > 0)) return records;
  let files;
  try { files = (await readdir(dir)).filter((file) => pattern.test(file)).sort().reverse(); }
  catch (error) { if (error.code !== "ENOENT") warn(error); return records; }
  for (const file of files) {
    let lines;
    try { lines = (await readFile(join(dir, file), "utf8")).split("\n").reverse(); }
    catch (error) { warn(error); continue; }
    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { continue; }
      if (records.length >= limit) return records;
    }
  }
  return records;
}
