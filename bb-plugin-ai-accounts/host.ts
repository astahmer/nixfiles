import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { z } from "zod";
import { readOpenCodexAccountUsage } from "./open-codex-usage";

const preferencesByRequest = new Map<string, {
  hiddenModelIds: Set<string>;
  modelOrder: string[];
  customModels: Array<{ id: string; displayName: string }>;
}>();
const requestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string().optional(),
  params: z.object({ providerOptions: z.record(z.string(), z.unknown()).optional() }).passthrough(),
}).passthrough();
const providerOptionsSchema = z.object({
  hiddenModelIds: z.array(z.string()).optional(),
  modelOrder: z.array(z.string()).optional(),
  customModels: z.array(z.object({ id: z.string(), displayName: z.string() })).optional(),
});
const responseSchema = z.object({
  id: z.union([z.string(), z.number()]),
  result: z.object({ models: z.array(z.unknown()).optional(), selectedOnlyModels: z.array(z.unknown()).optional() }).passthrough().optional(),
}).passthrough();
const originalWrite = process.stdout.write.bind(process.stdout);
let outputBuffer = "";

const forwardLine = (line: string) => {
  if (!line) return;
  let output = line;
  try {
    const decoded = responseSchema.safeParse(JSON.parse(line));
    if (decoded.success) {
        const id = String(decoded.data.id);
        const preferences = preferencesByRequest.get(id);
        if (preferences && decoded.data.result) {
          const filterAndSort = (models: unknown[]) => {
            const byId = new Map<string, unknown>();
            for (const model of models) {
              const modelId = modelIdOf(model);
              if (modelId && !preferences.hiddenModelIds.has(modelId)) byId.set(modelId, model);
            }
            for (const custom of preferences.customModels) {
              if (!preferences.hiddenModelIds.has(custom.id) && !byId.has(custom.id)) {
                byId.set(custom.id, {
                  id: custom.id,
                  model: custom.id,
                  displayName: custom.displayName,
                  description: "Custom provider model",
                  isDefault: false,
                  defaultReasoningEffort: "medium",
                  supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
                });
              }
            }
            return Array.from(byId.entries()).sort(([left], [right]) => {
              const leftIndex = preferences.modelOrder.indexOf(left);
              const rightIndex = preferences.modelOrder.indexOf(right);
              if (leftIndex < 0 && rightIndex < 0) return 0;
              if (leftIndex < 0) return 1;
              if (rightIndex < 0) return -1;
              return leftIndex - rightIndex;
            }).map(([, model]) => model);
          };
          output = JSON.stringify({
            ...decoded.data,
            result: {
              ...decoded.data.result,
              ...(decoded.data.result.models === undefined ? {} : { models: filterAndSort(decoded.data.result.models) }),
              ...(decoded.data.result.selectedOnlyModels === undefined ? {} : { selectedOnlyModels: filterAndSort(decoded.data.result.selectedOnlyModels) }),
            },
          });
        }
        preferencesByRequest.delete(id);
    }
  } catch {
    output = line;
  }
  originalWrite(output + "\n");
};

process.stdout.write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
  outputBuffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  let newlineIndex = outputBuffer.indexOf("\n");
  while (newlineIndex >= 0) {
    forwardLine(outputBuffer.slice(0, newlineIndex));
    outputBuffer = outputBuffer.slice(newlineIndex + 1);
    newlineIndex = outputBuffer.indexOf("\n");
  }
  const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
  if (done) done();
  return true;
}) as typeof process.stdout.write;

export const experimental_providerBridge = {
  ...experimental_acpProviderBridge,
  handleLine(line: string) {
    try {
      const decoded = requestSchema.safeParse(JSON.parse(line));
      if (decoded.success) {
        if (decoded.data.method === "provider/usage") {
          void readOpenCodexAccountUsage(decoded.data.params.providerOptions ?? {}).then((result) => {
            originalWrite(JSON.stringify({ jsonrpc: "2.0", id: decoded.data.id, result }) + "\n");
          }).catch(() => {
            originalWrite(JSON.stringify({
              jsonrpc: "2.0",
              id: decoded.data.id,
              result: { supported: true, usage: { status: "error", message: "OpenCodex usage could not be read." } },
            }) + "\n");
          });
          return;
        }
        const options = providerOptionsSchema.safeParse(decoded.data.params.providerOptions ?? {});
        if (options.success && (options.data.hiddenModelIds || options.data.modelOrder || options.data.customModels)) {
          preferencesByRequest.set(String(decoded.data.id), {
            hiddenModelIds: new Set(options.data.hiddenModelIds ?? []),
            modelOrder: options.data.modelOrder ?? [],
            customModels: options.data.customModels ?? [],
          });
          if (preferencesByRequest.size > 256) {
            const oldestRequestId = preferencesByRequest.keys().next().value;
            if (oldestRequestId !== undefined) preferencesByRequest.delete(oldestRequestId);
          }
        }
      }
    } catch {
      // The published ACP bridge owns malformed request handling.
    }
    experimental_acpProviderBridge.handleLine(line);
  },
};

const modelIdOf = (model: unknown) => {
  const decoded = z.object({ id: z.string().optional(), modelId: z.string().optional() }).passthrough().safeParse(model);
  return decoded.success ? decoded.data.id ?? decoded.data.modelId : undefined;
};
