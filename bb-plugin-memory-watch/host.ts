import { spawn } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract, type WorkerProcess } from "./contract";

const MAX_OUTPUT_BYTES = 2_000_000;
const PROCESS_LIMIT = 1_000;

const listProcesses = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    const args =
      process.platform === "darwin"
        ? ["-axo", "pid=,ppid=,rss=,pcpu=,command="]
        : ["-eo", "pid=,ppid=,rss=,pcpu=,args="];
    const child = spawn("ps", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        reject(new Error("Timed out reading the BB process list."));
      }
    }, 5_000);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(new Error("Process listing exceeded the 2 MB safety limit."));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > 8_000) child.kill("SIGTERM");
    });
    child.once("error", (error) => finish(new Error(`Could not run ps: ${error.message}`)));
    child.once("close", (code) => {
      if (code !== 0 && !settled) {
        finish(new Error(stderr.trim() || `ps exited with code ${code ?? "unknown"}.`));
      } else {
        finish();
      }
    });
  });

const pluginIdFromCommand = (command: string): string | null =>
  command.match(/(?:^|\/)plugin-host-artifacts\/([a-z0-9-]+)\//)?.[1] ?? null;

const relevantProcess = (line: string): WorkerProcess | null => {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/.exec(line);
  if (!match) return null;

  const [, rawPid = "0", rawParentPid = "0", rawRssKb = "0", rawCpu = "0", command = ""] = match;
  const pluginId = pluginIdFromCommand(command);
  const role: WorkerProcess["role"] | null =
    command.includes("bb-provider-bridge-worker.mjs")
      ? "provider-bridge"
      : command.includes("bb-plugin-host-worker.mjs")
        ? "plugin-host"
        : pluginId !== null
          ? "plugin-mcp"
          : command.includes("/Applications/bb.app/") ||
              command.includes("bb Helper")
            ? "bb-app"
            : null;

  if (role === null) return null;
  if (role !== "bb-app" && pluginId === null) return null;

  return {
    pid: Number(rawPid),
    parentPid: Number(rawParentPid),
    rssKb: Number(rawRssKb),
    psCpuPercent: Number(rawCpu),
    pluginId,
    role,
  };
};

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    snapshot: async () => {
      if (process.platform !== "darwin" && process.platform !== "linux") {
        throw new Error("Memory Watch currently supports macOS and Linux.");
      }

      const ownMemory = process.memoryUsage();
      const all = (await listProcesses())
        .split("\n")
        .map(relevantProcess)
        .filter((entry): entry is WorkerProcess => entry !== null)
        .sort((left, right) => right.rssKb - left.rssKb)
        .slice(0, PROCESS_LIMIT);
      const bbAppRssKb = all.reduce((sum, entry) => sum + entry.rssKb, 0);
      const sharedBbAppRssKb = all
        .filter((entry) => entry.role === "bb-app")
        .reduce((sum, entry) => sum + entry.rssKb, 0);
      const isolatedPluginRssKb = all
        .filter((entry) => entry.pluginId !== null)
        .reduce((sum, entry) => sum + entry.rssKb, 0);

      return {
        sampledAt: new Date().toISOString(),
        platform: process.platform,
        ownProcess: {
          pid: process.pid,
          rssBytes: ownMemory.rss,
          heapUsedBytes: ownMemory.heapUsed,
          externalBytes: ownMemory.external,
          arrayBuffersBytes: ownMemory.arrayBuffers,
        },
        bbAppRssKb,
        sharedBbAppRssKb,
        isolatedPluginRssKb,
        processes: all,
      };
    },
  },
});
