import { type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  hostContract,
  rpcContract,
  type HostSnapshot,
  type MemoryReport,
  type WorkerProcess,
} from "./contract";

const usage = [
  "Usage:",
  "  bb memory-watch report [--json] [--processes]",
].join("\n");

const formatScaled = (value: number, units: string[]) => {
  if (value === 0) return `0 ${units[0] ?? "B"}`;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex] ?? "B"}`;
};
const memory = (kb: number) => formatScaled(kb, ["KB", "MB", "GB", "TB"]);
const bundleSize = (bytes: number) => formatScaled(bytes, ["B", "KB", "MB", "GB", "TB"]);

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  const collectReport = async (signal?: AbortSignal) => {
    const { primaryHostId } = await bb.sdk.system.config({ signal });
    if (primaryHostId === null) {
      throw new Error("BB has no primary host configured, so Memory Watch cannot sample its processes.");
    }
    const [snapshot, inventory] = await Promise.all([
      host.call("snapshot", null, { hostId: primaryHostId, signal, timeoutMs: 10_000 }),
      bb.sdk.plugins.list({ signal }),
    ]);
    return createReport(snapshot, inventory.plugins, bb.pluginId);
  };

  bb.rpc.register(rpcContract, {
    report: () => collectReport(),
  });

  bb.cli.register({
    name: "memory-watch",
    summary: "Report BB process memory and per-plugin isolated worker usage",
    commands: [
      {
        name: "report",
        summary: "Take a read-only memory and plugin activity snapshot",
        usage: "bb memory-watch report [--json] [--processes]",
      },
    ],
    async run(argv, context) {
      const json = argv.includes("--json");
      const processes = argv.includes("--processes");
      const remaining = argv.filter((arg) => arg !== "--json" && arg !== "--processes");
      if (remaining.length > 1 || (remaining[0] !== undefined && remaining[0] !== "report")) {
        return { exitCode: 1, stderr: usage };
      }
      if (remaining.length === 0 && !argv.includes("--help") && !argv.includes("-h")) {
        return { exitCode: 1, stderr: usage };
      }
      if (argv.includes("--help") || argv.includes("-h")) {
        return { exitCode: 0, stdout: usage };
      }

      try {
        const output = await collectReport(context.signal);

        if (json) {
          return { exitCode: 0, stdout: JSON.stringify(output) };
        }
        return { exitCode: 0, stdout: formatReport(output, processes) };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  bb.log.info("loaded");
}

type InstalledPlugin = Awaited<ReturnType<BbPluginApi["sdk"]["plugins"]["list"]>>["plugins"][number];

type PluginUsage = {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  workerRssKb: number;
  workerPsCpuPercent: number;
  workerProcessCount: number;
  isolatedWorkerSharePercent: number | null;
  handlerCount: number;
  handlerTotalMs: number;
  handlerErrorCount: number;
  activeServiceCount: number;
  scheduleCount: number;
  frontendBundleBytes: number;
  isSampler: boolean;
  attribution: "measured-worker-process" | "shared-server-or-renderer";
};

function createReport(
  snapshot: HostSnapshot,
  plugins: InstalledPlugin[],
  samplerPluginId: string,
): MemoryReport {
  const byPlugin = new Map<string, WorkerProcess[]>();
  for (const process of snapshot.processes) {
    if (process.pluginId === null) continue;
    const current = byPlugin.get(process.pluginId) ?? [];
    current.push(process);
    byPlugin.set(process.pluginId, current);
  }

  const measuredPluginsRssKb = snapshot.processes
    .filter((process) => process.pluginId !== null && process.pluginId !== samplerPluginId)
    .reduce((sum, process) => sum + process.rssKb, 0);
  const pluginRows: PluginUsage[] = plugins.map((plugin) => {
    const isSampler = plugin.id === samplerPluginId;
    const workerProcesses = byPlugin.get(plugin.id) ?? [];
    const workerRssKb = workerProcesses.reduce((sum, process) => sum + process.rssKb, 0);
    return {
      id: plugin.id,
      name: plugin.name ?? plugin.id,
      enabled: plugin.enabled,
      status: plugin.status,
      workerRssKb,
      workerPsCpuPercent: workerProcesses.reduce((sum, process) => sum + process.psCpuPercent, 0),
      workerProcessCount: workerProcesses.length,
      isolatedWorkerSharePercent:
        isSampler || workerRssKb === 0 || measuredPluginsRssKb === 0
          ? null
          : (workerRssKb / measuredPluginsRssKb) * 100,
      handlerCount: plugin.handlerStats.count,
      handlerTotalMs: plugin.handlerStats.totalMs,
      handlerErrorCount: plugin.handlerStats.errorCount,
      activeServiceCount: plugin.services.filter((service) => service.state === "running").length,
      scheduleCount: plugin.schedules.length,
      frontendBundleBytes: plugin.app.bundle?.jsBytes ?? 0,
      isSampler,
      attribution:
        workerProcesses.length > 0
          ? "measured-worker-process"
          : "shared-server-or-renderer",
    };
  });

  pluginRows.sort(
    (left, right) =>
      right.workerRssKb - left.workerRssKb ||
      right.handlerTotalMs - left.handlerTotalMs ||
      left.name.localeCompare(right.name),
  );

  return {
    sampledAt: snapshot.sampledAt,
    hostPlatform: snapshot.platform,
    totals: {
      bbAppAndPluginRssKb: snapshot.bbAppRssKb,
      sharedBbAppRssKb: snapshot.sharedBbAppRssKb,
      isolatedPluginRssKb: snapshot.isolatedPluginRssKb,
      isolatedPluginRssKbExcludingSampler: measuredPluginsRssKb,
      pluginCount: plugins.length,
      pluginsWithMeasuredWorkerMemory: pluginRows.filter((plugin) => plugin.workerProcessCount > 0).length,
      pluginsWithMeasuredWorkerMemoryExcludingSampler: pluginRows.filter(
        (plugin) => !plugin.isSampler && plugin.workerProcessCount > 0,
      ).length,
      workerShareDenominator: "sum of RSS for separately launched plugin host, provider-bridge, and plugin MCP processes, excluding Memory Watch sampler",
      memoryAccounting: "RSS sums can count shared physical pages more than once",
    },
    sampler: {
      pid: snapshot.ownProcess.pid,
      rssBytes: snapshot.ownProcess.rssBytes,
      heapUsedBytes: snapshot.ownProcess.heapUsedBytes,
      externalBytes: snapshot.ownProcess.externalBytes,
      arrayBuffersBytes: snapshot.ownProcess.arrayBuffersBytes,
    },
    plugins: pluginRows,
    processes: snapshot.processes,
    limitations: [
      "BB does not expose per-plugin heap or RSS for code running inside its shared server or renderer processes.",
      "Plugins without a separate worker are listed with shared-server-or-renderer attribution; their individual memory cannot be measured by this plugin.",
      "Handler time, service count, and bundle size are activity or size clues, not memory measurements.",
      "The app total includes BB app/helper and discovered plugin processes. It does not include provider/model subprocesses that cannot be identified from BB plugin worker paths.",
      "RSS is resident process memory; summing RSS may count shared pages more than once.",
    ],
  };
}

function formatReport(
  report: ReturnType<typeof createReport>,
  showProcesses: boolean,
): string {
  const lines = [
    `BB memory snapshot · ${report.sampledAt}`,
    `BB app + discovered plugin workers: ${memory(report.totals.bbAppAndPluginRssKb)} RSS`,
    `Shared BB app/server/renderer processes: ${memory(report.totals.sharedBbAppRssKb)} RSS`,
    `Separately measured plugin workers: ${memory(report.totals.isolatedPluginRssKbExcludingSampler)} RSS across ${report.totals.pluginsWithMeasuredWorkerMemoryExcludingSampler}/${Math.max(0, report.totals.pluginCount - 1)} other plugins`,
    `Memory Watch sampler: ${memory(report.sampler.rssBytes / 1024)} RSS · ${memory(report.sampler.heapUsedBytes / 1024)} heap`,
    "",
    "Plugin | status | worker RSS | share of measured workers | ps %CPU | handlers / cumulative time | services | UI bundle | attribution",
    "--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---",
  ];

  for (const plugin of report.plugins) {
    let share = "—";
    if (plugin.isSampler) share = "sampler";
    else if (plugin.isolatedWorkerSharePercent !== null) {
      share = `${plugin.isolatedWorkerSharePercent.toFixed(1)}%`;
    }
    lines.push(
      `${plugin.name} (${plugin.id}) | ${plugin.status}${plugin.enabled ? "" : ", disabled"} | ${plugin.workerProcessCount === 0 ? "—" : memory(plugin.workerRssKb)} | ${share} | ${plugin.workerProcessCount === 0 ? "—" : `${plugin.workerPsCpuPercent.toFixed(1)}%`} | ${plugin.handlerCount.toLocaleString()} / ${(plugin.handlerTotalMs / 1000).toFixed(1)}s | ${plugin.activeServiceCount} | ${plugin.frontendBundleBytes === 0 ? "—" : bundleSize(plugin.frontendBundleBytes)} | ${plugin.attribution === "measured-worker-process" ? "measured" : "shared"}`,
    );
  }

  lines.push(
    "",
    "Limits: shared server and renderer memory cannot be split by plugin through BB’s current SDK. Activity and bundle columns are clues only. RSS sums may double-count shared pages; provider/model child processes are excluded unless they use a plugin worker path.",
  );

  if (showProcesses) {
    lines.push(
      "",
      "Processes (largest first):",
      "PID | role | plugin | RSS | ps %CPU | parent",
      "---: | --- | --- | ---: | ---: | ---:",
    );
    for (const process of report.processes) {
      lines.push(
        `${process.pid} | ${process.role} | ${process.pluginId ?? "BB"} | ${memory(process.rssKb)} | ${process.psCpuPercent.toFixed(1)}% | ${process.parentPid}`,
      );
    }
  }

  return lines.join("\n");
}
