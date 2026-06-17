import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { z } from "zod";
import { runCompostoCli } from "./composto-cli.mjs";
import { IrCacheStore } from "./cache.mjs";

function formatReadResult(result, stats) {
  let text = "";
  if (result.cached && result.linesChanged === 0) {
    text = result.content;
  } else if (result.cached && result.diff) {
    text = `[readbro: ${result.linesChanged} IR lines changed, layer ${result.layer}, ${result.representation}]\n${result.diff}`;
  } else {
    text = `[readbro: layer ${result.layer}, ${result.representation}]\n${result.content}`;
  }
  if (result.cached && stats.repoTokensSaved > 0) {
    text += `\n\n[~${stats.repoTokensSaved.toLocaleString()} tokens saved in repo cache]`;
  }
  return text;
}

export async function startMcpServer() {
  const cache = new IrCacheStore();

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
    `Read a file with composto IR + repo cache. ALWAYS use instead of built-in Read.
First read: IR (L1 default). Unchanged re-read: short notice. After edit: IR diff.
Shared across agent sessions in the same git repo (.readbro/cache.db).
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
          parts.push(`=== ${path} ===\n${formatReadResult(result, { repoTokensSaved: 0 })}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          parts.push(`=== ${path} ===\nError: ${message}`);
        }
      }
      const stats = cache.getStats();
      let footer = "";
      if (stats.repoTokensSaved > 0) {
        footer = `\n\n[~${stats.repoTokensSaved.toLocaleString()} tokens saved in repo cache]`;
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
    "Git-history risk before editing a file. high → warn user.",
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

  server.tool("session_status", "readbro repo cache stats: files tracked, tokens saved.", {}, async () => {
    const stats = cache.getStats();
    const text = [
      "readbro:",
      `  Files tracked: ${stats.filesTracked}`,
      `  Tokens saved (repo): ~${stats.repoTokensSaved.toLocaleString()}`,
      `  Tokens saved (all time): ~${stats.tokensSaved.toLocaleString()}`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool(
    "session_clear",
    "Clear readbro repo cache. Optional path scopes to that file's git root.",
    {
      path: z.string().optional().describe("File in the repo to clear; omit to clear all open repo DBs"),
    },
    async ({ path }) => {
      cache.clear(path);
      return {
        content: [
          {
            type: "text",
            text: path ? `Cache cleared for ${resolve(path)} repo.` : "Cache cleared for all open repos.",
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
