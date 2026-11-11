import fs from "node:fs";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";

/*
 * Rates are the difference from the previous reading, as top's are: the first one samples twice, a short while apart.
 * What a platform cannot say is null rather than guessed.
 */
const TICKS = 100; // USER_HZ: /proc's clock ticks per second on every Linux Conduit runs on.
// Resident memory is counted in pages; arm64 machines may use 16K or 64K ones.
let pageSize = null;
const page = () => pageSize ??= (() => { try { return Number(execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }).trim()) || 4096; } catch { return 4096; } })();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cpuTimes = () => os.cpus().reduce((sum, cpu) => {
  const total = Object.values(cpu.times).reduce((all, value) => all + value, 0);
  return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
}, { idle: 0, total: 0 });

async function linuxNetwork() {
  const text = await fs.promises.readFile("/proc/net/dev", "utf8").catch(() => null);
  if (!text) return null;
  let rx = 0, tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || name.trim() === "lo") continue;
    const fields = rest.trim().split(/\s+/).map(Number);
    rx += fields[0] || 0; tx += fields[8] || 0;
  }
  return { rx, tx };
}

async function linuxMemoryAvailable() {
  const text = await fs.promises.readFile("/proc/meminfo", "utf8").catch(() => null);
  const kb = text?.match(/^MemAvailable:\s+(\d+)/m)?.[1];
  return kb ? Number(kb) * 1024 : null;
}

async function linuxProcesses() {
  const bytes = page();
  const entries = await fs.promises.readdir("/proc").catch(() => []);
  const out = new Map();
  await Promise.all(entries.filter((name) => /^\d+$/.test(name)).map(async (pid) => {
    const stat = await fs.promises.readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
    if (!stat) return;
    // The name is in parentheses and may hold spaces; the fields after it are space-separated.
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).split(" ");
    out.set(Number(pid), { name: stat.slice(open + 1, close), ticks: Number(fields[11]) + Number(fields[12]), memory: Number(fields[21]) * bytes });
  }));
  return out;
}

function macProcesses() {
  return new Promise((resolve) => execFile("ps", ["-Ao", "pid=,%cpu=,rss=,comm="], { timeout: 2000 }, (error, stdout) => {
    if (error) return resolve(null);
    resolve(stdout.split("\n").map((line) => line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/)).filter(Boolean)
      .map(([, pid, cpu, rss, command]) => ({ pid: Number(pid), name: command.split("/").at(-1), cpu: Number(cpu) / 100, memory: Number(rss) * 1024 })));
  }));
}

export function createMachineReadout({ root, top = 5 }) {
  let last = null;
  const sample = async () => ({
    at: Date.now(), cpu: cpuTimes(),
    network: process.platform === "linux" ? await linuxNetwork() : null,
    processes: process.platform === "linux" ? await linuxProcesses() : null,
  });

  return async function read() {
    if (!last || Date.now() - last.at > 60_000) { last = await sample(); await wait(250); }
    const now = await sample();
    const seconds = Math.max(0.001, (now.at - last.at) / 1000);
    const cores = os.cpus().length || 1;
    const cpuSpan = now.cpu.total - last.cpu.total;
    const cpu = cpuSpan > 0 ? Math.min(1, Math.max(0, 1 - (now.cpu.idle - last.cpu.idle) / cpuSpan)) : null;
    const network = now.network && last.network
      ? { rx: Math.max(0, (now.network.rx - last.network.rx) / seconds), tx: Math.max(0, (now.network.tx - last.network.tx) / seconds) } : null;
    let processes = null;
    if (now.processes) {
      processes = [...now.processes].map(([pid, item]) => {
        const before = last.processes?.get(pid);
        // A share of one core, as top shows it: 1 is a core busy for the whole interval.
        return { pid, name: item.name, cpu: before ? Math.max(0, (item.ticks - before.ticks) / TICKS / seconds) : 0, memory: item.memory };
      });
    } else if (process.platform === "darwin") processes = await macProcesses();
    const available = process.platform === "linux" ? await linuxMemoryAvailable() : null;
    const total = os.totalmem();
    const disk = await fs.promises.statfs(root).then((stats) => ({ total: stats.blocks * stats.bsize, used: (stats.blocks - stats.bavail) * stats.bsize })).catch(() => null);
    last = now;
    return {
      at: new Date(now.at).toISOString(), host: os.hostname(), platform: process.platform, uptime: os.uptime(),
      cores, load: process.platform === "win32" ? null : os.loadavg(), cpu,
      memory: { total, used: total - (available ?? os.freemem()) },
      disk: disk && { ...disk, path: root },
      network,
      processes: processes && processes.sort((a, b) => b.cpu - a.cpu || b.memory - a.memory).slice(0, top),
    };
  };
}
