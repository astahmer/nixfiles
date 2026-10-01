import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const workerProcessSchema = z.object({
  pid: z.number().int().nonnegative(),
  parentPid: z.number().int().nonnegative(),
  rssKb: z.number().nonnegative(),
  psCpuPercent: z.number().nonnegative(),
  pluginId: z.string().nullable(),
  role: z.enum(["bb-app", "plugin-host", "provider-bridge", "plugin-mcp"]),
});

export const snapshotSchema = z.object({
  sampledAt: z.string(),
  platform: z.string(),
  ownProcess: z.object({
    pid: z.number().int().nonnegative(),
    rssBytes: z.number().nonnegative(),
    heapUsedBytes: z.number().nonnegative(),
    externalBytes: z.number().nonnegative(),
    arrayBuffersBytes: z.number().nonnegative(),
  }),
  bbAppRssKb: z.number().nonnegative(),
  sharedBbAppRssKb: z.number().nonnegative(),
  isolatedPluginRssKb: z.number().nonnegative(),
  processes: z.array(workerProcessSchema),
});

export type WorkerProcess = z.infer<typeof workerProcessSchema>;
export type HostSnapshot = z.infer<typeof snapshotSchema>;

export const pluginUsageSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  status: z.string(),
  workerRssKb: z.number().nonnegative(),
  workerPsCpuPercent: z.number().nonnegative(),
  workerProcessCount: z.number().int().nonnegative(),
  isolatedWorkerSharePercent: z.number().nonnegative().nullable(),
  handlerCount: z.number().nonnegative(),
  handlerTotalMs: z.number().nonnegative(),
  handlerErrorCount: z.number().nonnegative(),
  activeServiceCount: z.number().int().nonnegative(),
  scheduleCount: z.number().int().nonnegative(),
  frontendBundleBytes: z.number().nonnegative(),
  isSampler: z.boolean(),
  attribution: z.enum(["measured-worker-process", "shared-server-or-renderer"]),
});

export const reportSchema = z.object({
  sampledAt: z.string(),
  hostPlatform: z.string(),
  totals: z.object({
    bbAppAndPluginRssKb: z.number().nonnegative(),
    sharedBbAppRssKb: z.number().nonnegative(),
    isolatedPluginRssKb: z.number().nonnegative(),
    isolatedPluginRssKbExcludingSampler: z.number().nonnegative(),
    pluginCount: z.number().int().nonnegative(),
    pluginsWithMeasuredWorkerMemory: z.number().int().nonnegative(),
    pluginsWithMeasuredWorkerMemoryExcludingSampler: z.number().int().nonnegative(),
    workerShareDenominator: z.string(),
    memoryAccounting: z.string(),
  }),
  sampler: z.object({
    pid: z.number().int().nonnegative(),
    rssBytes: z.number().nonnegative(),
    heapUsedBytes: z.number().nonnegative(),
    externalBytes: z.number().nonnegative(),
    arrayBuffersBytes: z.number().nonnegative(),
  }),
  plugins: z.array(pluginUsageSchema).max(500),
  processes: z.array(workerProcessSchema).max(1_000),
  limitations: z.array(z.string()).max(10),
});

export type MemoryReport = z.infer<typeof reportSchema>;

export const rpcContract = defineRpcContract({
  report: {
    input: z.null(),
    output: reportSchema,
  },
});

export const hostContract = defineRpcContract({
  snapshot: {
    input: z.null(),
    output: snapshotSchema,
  },
});
