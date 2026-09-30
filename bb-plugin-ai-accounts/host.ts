import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";

const hiddenByRequest = new Map<string, Set<string>>();
const originalWrite = process.stdout.write.bind(process.stdout);
let outputBuffer = "";

const forwardLine = (line: string) => {
  if (!line) return;
  let output = line;
  try {
    const response: unknown = JSON.parse(line);
    if (typeof response === "object" && response !== null && "id" in response) {
      const id = String(response.id);
      const hidden = hiddenByRequest.get(id);
      if (hidden && "result" in response && typeof response.result === "object" && response.result !== null) {
        const result = response.result as { models?: unknown; selectedOnlyModels?: unknown };
        const filter = (models: unknown) =>
          Array.isArray(models)
            ? models.filter((model) => typeof model !== "object" || model === null || !("id" in model) || typeof model.id !== "string" || !hidden.has(model.id))
            : models;
        output = JSON.stringify({
          ...response,
          result: {
            ...result,
            ...(result.models === undefined ? {} : { models: filter(result.models) }),
            ...(result.selectedOnlyModels === undefined ? {} : { selectedOnlyModels: filter(result.selectedOnlyModels) }),
          },
        });
      }
      hiddenByRequest.delete(id);
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
      const request: unknown = JSON.parse(line);
      if (typeof request === "object" && request !== null && "id" in request && "params" in request && typeof request.params === "object" && request.params !== null) {
        const params = request.params as { providerOptions?: Record<string, unknown> };
        const hiddenModels = params.providerOptions?.hiddenModelIds;
        if (Array.isArray(hiddenModels) && hiddenModels.every((model) => typeof model === "string")) {
          hiddenByRequest.set(String(request.id), new Set(hiddenModels));
        }
      }
    } catch {
      // The published ACP bridge owns malformed request handling.
    }
    experimental_acpProviderBridge.handleLine(line);
  },
};
