import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { z } from "zod";
import { readCodexUsage } from "./codex-usage";
import { readOpenCodeGoUsage } from "./opencode-go-usage";

const preferencesByRequest = new Map<string, {
  hiddenModelIds: Set<string>;
  modelOrder: string[];
  customModels: Array<{ id: string; displayName: string }>;
  modelReasoningDefaults: Record<string, "none" | "low" | "medium" | "high" | "xhigh" | "ultracode" | "max" | "ultra">;
}>();
const requestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string().optional(),
  params: z.object({ providerOptions: z.record(z.string(), z.unknown()).optional() }).passthrough(),
}).passthrough();
const usageProviderSchema = z.object({ accountProvider: z.enum(["codex", "opencode-go"]) });
const providerOptionsSchema = z.object({
  hiddenModelIds: z.array(z.string()).optional(),
  modelOrder: z.array(z.string()).optional(),
  customModels: z.array(z.object({ id: z.string(), displayName: z.string() })).optional(),
  modelReasoningDefaults: z.record(z.string(), z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"])).optional(),
});
const reasoningEffortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]);
const availableModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: reasoningEffortSchema, description: z.string() })),
  defaultReasoningEffort: reasoningEffortSchema,
  isDefault: z.boolean(),
}).passthrough();
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
            const routedDefaults = new Set(models.flatMap((rawModel) => {
              const decodedModel = availableModelSchema.safeParse(rawModel);
              if (!decodedModel.success || !decodedModel.data.isDefault || !decodedModel.data.id.startsWith("codex-perso/")) return [];
              return [decodedModel.data.id.slice("codex-perso/".length)];
            }));
            for (const rawModel of models) {
              const decodedModel = availableModelSchema.safeParse(rawModel);
              if (!decodedModel.success) continue;
              const model = decodedModel.data;
              const modelId = model.id;
              if (modelId.startsWith("codex-perso/") || preferences.hiddenModelIds.has(modelId)) continue;
              const configuredDefault = preferences.modelReasoningDefaults[modelId];
              const defaultReasoningEffort = configuredDefault && model.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === configuredDefault)
                ? configuredDefault
                : model.defaultReasoningEffort;
              byId.set(modelId, { ...model, defaultReasoningEffort, isDefault: model.isDefault || routedDefaults.has(modelId) });
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
          const usageProvider = usageProviderSchema.safeParse(decoded.data.params.providerOptions ?? {});
          const readUsage = usageProvider.success && usageProvider.data.accountProvider === "opencode-go" ? readOpenCodeGoUsage : readCodexUsage;
          void readUsage().then((result) => {
            originalWrite(JSON.stringify({ jsonrpc: "2.0", id: decoded.data.id, result }) + "\n");
          }).catch(() => {
            originalWrite(JSON.stringify({
              jsonrpc: "2.0",
              id: decoded.data.id,
              result: { supported: true, usage: { status: "error", accountEmail: null, planLabel: null, message: "Codex subscription limits could not be read." } },
            }) + "\n");
          });
          return;
        }
        const options = providerOptionsSchema.safeParse(decoded.data.params.providerOptions ?? {});
        if (options.success && (options.data.hiddenModelIds || options.data.modelOrder || options.data.customModels || options.data.modelReasoningDefaults)) {
          preferencesByRequest.set(String(decoded.data.id), {
            hiddenModelIds: new Set(options.data.hiddenModelIds ?? []),
            modelOrder: options.data.modelOrder ?? [],
            customModels: options.data.customModels ?? [],
            modelReasoningDefaults: options.data.modelReasoningDefaults ?? {},
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
