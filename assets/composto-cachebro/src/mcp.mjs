import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defaultDbPath, IrCacheStore } from "./cache.mjs";

export async function startMcpServer() {
  const sessionId = randomUUID();
  const cache = new IrCacheStore(defaultDbPath(), sessionId);

  const server = new McpServer({
    name: "composto-cachebro",
    version: "0.1.0",
  });

  const layerSchema = z
    .enum(["L0", "L1", "L2", "L3"])
    .default("L1")
    .describe("Composto IR layer. L0=outline, L1=IR (default), L2=delta (falls back), L3=raw source");

  server.tool(
    "read_file",
    `Read a file via composto IR with session caching. Prefer over built-in Read and over bare composto_ir.
First read: returns composto IR (L1 default) or raw fallback for non-code files.
Re-read unchanged file: short unchanged notice (~tokens saved).
Re-read after edit: unified diff of IR (not raw source diff).
Use layer=L3 when you need exact source. force=true bypasses cache.`,
    {
      path: z.string().describe("Path to the file"),
      layer: layerSchema.optional(),
      force: z.boolean().optional().describe("Bypass cache, return full payload"),
    },
    async ({ path, layer, force }) => {
      try {
        const result = cache.readFile(path, { layer: layer ?? "L1", force: force ?? false });
        let text = "";
        if (result.cached && result.linesChanged === 0) {
          text = result.content;
        } else if (result.cached && result.diff) {
          text = `[composto-cachebro: ${result.linesChanged} IR lines changed, layer ${result.layer}, ${result.representation}]\n${result.diff}`;
        } else {
          text = `[composto-cachebro: layer ${result.layer}, ${result.representation}]\n${result.content}`;
        }
        const stats = cache.getStats();
        if (result.cached && stats.sessionTokensSaved > 0) {
          text += `\n\n[~${stats.sessionTokensSaved.toLocaleString()} tokens saved this session]`;
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    "read_files",
    "Batch read files with composto IR caching. Same semantics as read_file.",
    {
      paths: z.array(z.string()),
      layer: layerSchema.optional(),
    },
    async ({ paths, layer }) => {
      const parts = [];
      for (const path of paths) {
        try {
          const result = cache.readFile(path, { layer: layer ?? "L1" });
          let block = "";
          if (result.cached && result.linesChanged === 0) {
            block = `=== ${path} ===\n${result.content}`;
          } else if (result.cached && result.diff) {
            block = `=== ${path} [${result.linesChanged} IR lines changed] ===\n${result.diff}`;
          } else {
            block = `=== ${path} (${result.layer}, ${result.representation}) ===\n${result.content}`;
          }
          parts.push(block);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          parts.push(`=== ${path} ===\nError: ${message}`);
        }
      }
      const stats = cache.getStats();
      let footer = "";
      if (stats.sessionTokensSaved > 0) {
        footer = `\n\n[~${stats.sessionTokensSaved.toLocaleString()} tokens saved this session]`;
      }
      return { content: [{ type: "text", text: parts.join("\n\n") + footer }] };
    },
  );

  server.tool("cache_status", "composto-cachebro stats: files tracked, tokens saved.", {}, async () => {
    const stats = cache.getStats();
    const text = [
      "composto-cachebro:",
      `  Files tracked: ${stats.filesTracked}`,
      `  Tokens saved (session): ~${stats.sessionTokensSaved.toLocaleString()}`,
      `  Tokens saved (total): ~${stats.tokensSaved.toLocaleString()}`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("cache_clear", "Clear composto-cachebro session cache.", {}, async () => {
    cache.clear();
    return { content: [{ type: "text", text: "Cache cleared." }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
