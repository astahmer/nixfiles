import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { runCompostoCli } from "./composto-cli.mjs";
import { defaultDbPath, IrCacheStore } from "./cache.mjs";

function formatReadResult(result, stats) {
  let text = "";
  if (result.cached && result.linesChanged === 0) {
    text = result.content;
  } else if (result.cached && result.diff) {
    text = `[readbro: ${result.linesChanged} IR lines changed, layer ${result.layer}, ${result.representation}]\n${result.diff}`;
  } else {
    text = `[readbro: layer ${result.layer}, ${result.representation}]\n${result.content}`;
  }
  if (result.cached && stats.sessionTokensSaved > 0) {
    text += `\n\n[~${stats.sessionTokensSaved.toLocaleString()} tokens saved this session]`;
  }
  return text;
}

export async function startMcpServer() {
  const sessionId = randomUUID();
  const cache = new IrCacheStore(defaultDbPath(), sessionId);

  const server = new McpServer({
    name: "readbro",
    version: "0.2.0",
  });

  const layerSchema = z
    .enum(["L0", "L1", "L2", "L3"])
    .default("L1")
    .describe("IR layer. L0=outline, L1=compressed IR (default), L3=raw source");

  server.tool(
    "read_file",
    `Read a file with composto IR + session cache. ALWAYS use instead of built-in Read.
First read: IR (L1 default). Unchanged re-read: short notice. After edit: IR diff.
layer=L3 for exact source. force=true bypasses cache.`,
    {
      path: z.string().describe("Path to the file"),
      layer: layerSchema.optional(),
      force: z.boolean().optional().describe("Bypass cache"),
    },
    async ({ path, layer, force }) => {
      try {
        const result = cache.readFile(path, { layer: layer ?? "L1", force: force ?? false });
        const stats = cache.getStats();
        return { content: [{ type: "text", text: formatReadResult(result, stats) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    "read_files",
    "Batch read with IR caching. Prefer over multiple read_file or built-in Read calls.",
    {
      paths: z.array(z.string()),
      layer: layerSchema.optional(),
    },
    async ({ paths, layer }) => {
      const parts = [];
      for (const path of paths) {
        try {
          const result = cache.readFile(path, { layer: layer ?? "L1" });
          parts.push(`=== ${path} ===\n${formatReadResult(result, { sessionTokensSaved: 0 })}`);
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

  server.tool(
    "pack_context",
    "Multi-file bug/trace context within token budget. Target file raw, neighbours IR.",
    {
      path: z.string().default(".").describe("Project directory"),
      budget: z.number().default(4000).describe("Token budget"),
      target: z.string().optional().describe("Symbol or file to focus"),
    },
    async ({ path, budget, target }) => {
      try {
        const abs = resolve(path);
        const args = ["context", abs, `--budget=${budget}`];
        if (target) args.push(`--target=${target}`);
        const text = runCompostoCli(args, abs);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    "blast_radius",
    "Git-history risk before editing a file. high → warn user. Hook also runs on Edit/Write.",
    {
      file: z.string().describe("File path to assess"),
      intent: z
        .enum(["refactor", "bugfix", "feature", "test", "docs", "unknown"])
        .optional()
        .describe("Edit intent"),
    },
    async ({ file, intent }) => {
      try {
        const abs = resolve(file);
        const args = ["impact", abs];
        if (intent) args.push(`--intent=${intent}`);
        const text = runCompostoCli(args, abs);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool("session_status", "readbro cache stats: files tracked, tokens saved.", {}, async () => {
    const stats = cache.getStats();
    const text = [
      "readbro:",
      `  Files tracked: ${stats.filesTracked}`,
      `  Tokens saved (session): ~${stats.sessionTokensSaved.toLocaleString()}`,
      `  Tokens saved (total): ~${stats.tokensSaved.toLocaleString()}`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("session_clear", "Clear readbro session cache.", {}, async () => {
    cache.clear();
    return { content: [{ type: "text", text: "Cache cleared." }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
