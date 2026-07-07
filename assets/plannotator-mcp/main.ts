#!/usr/bin/env bun
/**
 * Plannotator MCP wrapper.
 *
 * Plannotator is a CLI tool with its own hook/bridge protocol, not a native MCP
 * server. This thin stdio adapter exposes its interactive workflows as MCP tools
 * so any agent harness (Cursor, VS Code, OpenCode, etc.) can invoke them through
 * Executor.
 */
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve, join, sep } from "node:path";

const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const tools = [
  {
    name: "review_plan",
    description:
      "Open the Plannotator browser UI to review an agent-generated plan. " +
      "Blocks until you approve or deny, then returns the decision and any feedback.",
    inputSchema: {
      type: "object" as const,
      properties: {
        plan: {
          type: "string" as const,
          description: "The plan markdown content to review.",
        },
        timeoutSeconds: {
          type: "number" as const,
          description:
            "Optional timeout. If you do not respond in time, the tool " +
            "returns a denial so the agent can retry.",
        },
        workingDirectory: {
          type: "string" as const,
          description:
            "Optional working directory. Used for project-name detection and " +
            "resolving relative paths.",
        },
      },
      required: ["plan"],
    },
  },
  {
    name: "review_code",
    description:
      "Open the Plannotator browser UI to review the current VCS changes or a " +
      "pull request. Blocks until you submit feedback or dismiss.",
    inputSchema: {
      type: "object" as const,
      properties: {
        arguments: {
          type: "string" as const,
          description:
            "Optional CLI-style arguments, e.g. '--git' or a PR URL. " +
            "Supports --git, --local/--no-local, and PR/MR URLs.",
        },
        workingDirectory: {
          type: "string" as const,
          description: "Optional working directory for VCS detection.",
        },
      },
    },
  },
  {
    name: "annotate_document",
    description:
      "Open the Plannotator browser UI to annotate a markdown file, HTML file, URL, " +
      "or folder. Blocks until you submit annotations or dismiss.",
    inputSchema: {
      type: "object" as const,
      properties: {
        target: {
          type: "string" as const,
          description:
            "Path, URL, or folder to annotate. Supports .md, .mdx, .txt, .html, " +
            "https:// URLs, and folder paths.",
        },
        gate: {
          type: "boolean" as const,
          description:
            "If true, adds an Approve button and emits structured decisions.",
        },
        workingDirectory: {
          type: "string" as const,
          description: "Optional working directory for resolving relative paths.",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "open_archive",
    description:
      "Open the Plannotator archive UI in the browser to browse saved plan decisions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workingDirectory: {
          type: "string" as const,
          description: "Optional working directory for project detection.",
        },
      },
    },
  },
  {
    name: "list_saved_decisions",
    description:
      "List plan decisions saved by Plannotator in ~/.plannotator/plans/. " +
      "These are the approved/denied snapshots produced by review_plan.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number" as const,
          description: "Maximum number of decisions to return (default: 50).",
        },
      },
    },
  },
  {
    name: "read_saved_decision",
    description:
      "Read the full markdown content of a saved Plannotator decision file " +
      "from ~/.plannotator/plans/. Use list_saved_decisions to find filenames.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string" as const,
          description:
            "Filename of the saved decision, e.g. 'my-plan-2026-07-07-approved.md'.",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "list_sessions",
    description:
      "List active Plannotator sessions. Returns a plain-text table, not structured JSON.",
    inputSchema: {
      type: "object" as const,
      properties: {
        clean: {
          type: "boolean" as const,
          description: "If true, removes stale session files.",
        },
        open: {
          type: "number" as const,
          description: "Reopen the Nth session (1-based) in the browser.",
        },
      },
    },
  },
];

function logDebug(message: string): void {
  if (process.env.PLANNOTATOR_MCP_DEBUG) {
    console.error(`[plannotator-mcp] ${message}`);
  }
}

function send(response: JsonRpcResponse): void {
  const line = JSON.stringify(response);
  logDebug(`--> ${line}`);
  process.stdout.write(`${line}\n`);
}

function makeResult(
  id: number | string | undefined,
  text: string,
  isError = false,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text }],
      isError,
    },
  };
}

function makeError(
  id: number | string | undefined,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function findPlannotator(): string {
  const fromEnv = process.env.PLANNOTATOR_PATH;
  if (fromEnv) return fromEnv;

  const pathEnv = process.env.PATH ?? "";
  const candidates = pathEnv.split(":").map((dir) => resolve(dir, "plannotator"));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error(
    "plannotator binary not found on PATH. Set PLANNOTATOR_PATH to override.",
  );
}

function runPlannotator(
  args: string[],
  input: string | undefined,
  cwd: string | undefined,
): { status: number | null; stdout: string; stderr: string } {
  const binary = findPlannotator();
  logDebug(`spawn: ${binary} ${args.join(" ")}`);

  const result = spawnSync(binary, args, {
    input,
    encoding: "utf8",
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: undefined,
  });

  if (result.stderr) {
    // Forward status/progress messages to the terminal so the user sees them.
    process.stderr.write(result.stderr);
  }

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function getPlannotatorDataDir(): string {
  const envDir = process.env.PLANNOTATOR_DATA_DIR;
  if (envDir) {
    return resolveUserPath(envDir);
  }
  return join(homedir(), ".plannotator");
}

function resolveUserPath(input: string): string {
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  return resolve(input);
}

interface SavedDecision {
  filename: string;
  title: string;
  date: string;
  status: "approved" | "denied" | "unknown";
  timestamp: string;
  size: number;
}

function parseDecisionFilename(filename: string): SavedDecision | null {
  if (!filename.endsWith(".md")) return null;
  if (filename.endsWith(".annotations.md") || filename.endsWith(".diff.md")) {
    return null;
  }

  const base = filename.replace(/\.md$/, "");
  let status: SavedDecision["status"] = "unknown";
  let slug = base;

  if (base.endsWith("-approved")) {
    status = "approved";
    slug = base.slice(0, -"-approved".length);
  } else if (base.endsWith("-denied")) {
    status = "denied";
    slug = base.slice(0, -"-denied".length);
  } else {
    return null;
  }

  const dateMatch = slug.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";
  const title = slug
    .replace(/\d{4}-\d{2}-\d{2}/, "")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, " ")
    .trim() || "Untitled Plan";

  return { filename, title, date, status, timestamp: "", size: 0 };
}

function listSavedDecisions(limit = 50): SavedDecision[] {
  const planDir = join(getPlannotatorDataDir(), "plans");
  if (!existsSync(planDir)) return [];

  try {
    const entries = readdirSync(planDir);
    const decisions: SavedDecision[] = [];
    for (const entry of entries) {
      const parsed = parseDecisionFilename(entry);
      if (!parsed) continue;
      try {
        const stat = statSync(join(planDir, entry));
        parsed.size = stat.size;
        parsed.timestamp = stat.mtime.toISOString();
      } catch { /* keep defaults */ }
      decisions.push(parsed);
    }
    return decisions
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.timestamp.localeCompare(a.timestamp),
      )
      .slice(0, limit);
  } catch {
    return [];
  }
}

function readSavedDecision(filename: string): string | null {
  const planDir = join(getPlannotatorDataDir(), "plans");
  const filePath = resolve(planDir, filename);
  if (!filePath.startsWith(planDir + sep)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function formatDecision(
  decision: Record<string, unknown>,
  stderr: string,
): string {
  const approved = decision.approved === true;
  const decisionField =
    typeof decision.decision === "string" ? decision.decision : undefined;
  const feedback =
    typeof decision.feedback === "string" ? decision.feedback : undefined;
  const savedPath =
    typeof decision.savedPath === "string" ? decision.savedPath : undefined;

  let text = `Decision: ${decisionField ?? (approved ? "approved" : "annotated/denied")}\n`;
  if (feedback) text += `\nFeedback:\n${feedback}\n`;
  if (savedPath) text += `\nSaved to: ${savedPath}\n`;
  text += `\nRaw JSON:\n${JSON.stringify(decision, null, 2)}`;
  if (stderr.trim()) {
    text += `\n\nServer output:\n${stderr.trim()}`;
  }
  return text;
}

function handleReviewPlan(
  id: number | string | undefined,
  args: Record<string, unknown>,
): JsonRpcResponse {
  const plan = typeof args.plan === "string" ? args.plan : "";
  if (!plan.trim()) {
    return makeError(id, -32602, "Missing required parameter: plan");
  }

  const payload: Record<string, unknown> = { plan };
  if (typeof args.timeoutSeconds === "number" && args.timeoutSeconds > 0) {
    payload.timeoutSeconds = args.timeoutSeconds;
  }
  if (typeof args.sharingEnabled === "boolean") {
    payload.sharingEnabled = args.sharingEnabled;
  }

  const cwd =
    typeof args.workingDirectory === "string"
      ? resolve(args.workingDirectory)
      : process.cwd();

  const { status, stdout, stderr } = runPlannotator(
    ["opencode-plan"],
    JSON.stringify(payload),
    cwd,
  );

  if (status !== 0) {
    return makeResult(
      id,
      `plannotator exited with status ${status}.\nStdout:\n${stdout || "(empty)"}\n\nStderr:\n${stderr || "(empty)"}`,
      true,
    );
  }

  const parsed = parseJsonSafe(stdout) as Record<string, unknown> | undefined;
  if (!parsed) {
    return makeResult(
      id,
      `plannotator did not return valid JSON.\nStdout:\n${stdout || "(empty)"}\n\nStderr:\n${stderr || "(empty)"}`,
      true,
    );
  }

  return makeResult(id, formatDecision(parsed, stderr));
}

function handleReviewCode(
  id: number | string | undefined,
  args: Record<string, unknown>,
): JsonRpcResponse {
  const payload: Record<string, unknown> = {};
  if (typeof args.arguments === "string") {
    payload.arguments = args.arguments;
  }

  const cwd =
    typeof args.workingDirectory === "string"
      ? resolve(args.workingDirectory)
      : process.cwd();

  const { status, stdout, stderr } = runPlannotator(
    ["opencode-review"],
    JSON.stringify(payload),
    cwd,
  );

  if (status !== 0) {
    return makeResult(
      id,
      `plannotator exited with status ${status}.\nStdout:\n${stdout || "(empty)"}\n\nStderr:\n${stderr || "(empty)"}`,
      true,
    );
  }

  const parsed = parseJsonSafe(stdout) as Record<string, unknown> | undefined;
  if (!parsed) {
    return makeResult(
      id,
      `plannotator did not return valid JSON.\nStdout:\n${stdout || "(empty)"}\n\nStderr:\n${stderr || "(empty)"}`,
      true,
    );
  }

  return makeResult(id, formatDecision(parsed, stderr));
}

function handleAnnotateDocument(
  id: number | string | undefined,
  args: Record<string, unknown>,
): JsonRpcResponse {
  const target = typeof args.target === "string" ? args.target : "";
  if (!target.trim()) {
    return makeError(id, -32602, "Missing required parameter: target");
  }

  const plannotatorArgs = ["annotate", target];
  if (args.gate === true) {
    plannotatorArgs.push("--gate", "--json");
  } else {
    plannotatorArgs.push("--json");
  }

  const cwd =
    typeof args.workingDirectory === "string"
      ? resolve(args.workingDirectory)
      : process.cwd();

  const { status, stdout, stderr } = runPlannotator(plannotatorArgs, undefined, cwd);

  if (status !== 0) {
    return makeResult(
      id,
      `plannotator exited with status ${status}.\nStdout:\n${stdout || "(empty)"}\n\nStderr:\n${stderr || "(empty)"}`,
      true,
    );
  }

  const parsed = parseJsonSafe(stdout) as Record<string, unknown> | undefined;
  if (parsed) {
    return makeResult(id, formatDecision(parsed, stderr));
  }

  const text = stdout || "Annotation completed with no output.";
  return makeResult(
    id,
    stderr.trim() ? `${text}\n\nServer output:\n${stderr.trim()}` : text,
  );
}

function handleOpenArchive(
  id: number | string | undefined,
  args: Record<string, unknown>,
): JsonRpcResponse {
  const cwd =
    typeof args.workingDirectory === "string"
      ? resolve(args.workingDirectory)
      : process.cwd();

  const { status, stdout, stderr } = runPlannotator(["archive"], undefined, cwd);

  if (status !== 0) {
    return makeResult(
      id,
      `plannotator exited with status ${status}.\nStdout:\n${stdout || "(empty)"}\n\nStderr:\n${stderr || "(empty)"}`,
      true,
    );
  }

  const text = stdout || "Archive session closed.";
  return makeResult(
    id,
    stderr.trim() ? `${text}\n\nServer output:\n${stderr.trim()}` : text,
  );
}

function handleListSessions(
  id: number | string | undefined,
  args: Record<string, unknown>,
): JsonRpcResponse {
  const plannotatorArgs = ["sessions"];
  if (args.clean === true) {
    plannotatorArgs.push("--clean");
  }
  if (typeof args.open === "number") {
    plannotatorArgs.push("--open", String(args.open));
  }

  const { status, stdout, stderr } = runPlannotator(
    plannotatorArgs,
    undefined,
    process.cwd(),
  );

  if (status !== 0) {
    return makeResult(
      id,
      `plannotator exited with status ${status}.\nStdout:\n${stdout || "(empty)"}\n\nStderr:\n${stderr || "(empty)"}`,
      true,
    );
  }

  const text = stdout || "Sessions command completed.";
  return makeResult(
    id,
    stderr.trim() ? `${text}\n\nServer output:\n${stderr.trim()}` : text,
  );
}

function handleListSavedDecisions(
  id: number | string | undefined,
  args: Record<string, unknown>,
): JsonRpcResponse {
  const limit =
    typeof args.limit === "number" && args.limit > 0 ? args.limit : 50;
  const decisions = listSavedDecisions(limit);

  if (decisions.length === 0) {
    return makeResult(id, "No saved plan decisions found in ~/.plannotator/plans/.");
  }

  const lines = decisions.map((d, i) => {
    const date = d.date || d.timestamp.split("T")[0] || "unknown";
    return `${i + 1}. [${d.status}] ${d.title} (${date}) — ${d.filename} (${d.size} bytes)`;
  });

  return makeResult(
    id,
    `Saved plan decisions:\n\n${lines.join("\n")}\n\nUse read_saved_decision with the filename to read the full markdown.`,
  );
}

function handleReadSavedDecision(
  id: number | string | undefined,
  args: Record<string, unknown>,
): JsonRpcResponse {
  const filename = typeof args.filename === "string" ? args.filename : "";
  if (!filename.trim()) {
    return makeError(id, -32602, "Missing required parameter: filename");
  }

  const content = readSavedDecision(filename);
  if (content === null) {
    return makeResult(
      id,
      `Could not read '${filename}'. Make sure it exists in ~/.plannotator/plans/ and is a decision file (ends with -approved.md or -denied.md).`,
      true,
    );
  }

  return makeResult(id, content);
}

function handleToolCall(
  id: number | string | undefined,
  params: Record<string, unknown>,
): JsonRpcResponse {
  const name = typeof params.name === "string" ? params.name : "";
  const args =
    params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

  switch (name) {
    case "review_plan":
      return handleReviewPlan(id, args);
    case "review_code":
      return handleReviewCode(id, args);
    case "annotate_document":
      return handleAnnotateDocument(id, args);
    case "open_archive":
      return handleOpenArchive(id, args);
    case "list_saved_decisions":
      return handleListSavedDecisions(id, args);
    case "read_saved_decision":
      return handleReadSavedDecision(id, args);
    case "list_sessions":
      return handleListSessions(id, args);
    default:
      return makeError(id, -32601, `Unknown tool: ${name}`);
  }
}

function handleRequest(request: JsonRpcRequest): JsonRpcResponse | undefined {
  logDebug(`<-- ${JSON.stringify(request)}`);

  switch (request.method) {
    case "initialize": {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "plannotator-mcp",
            version: "0.1.0",
          },
        },
      };
    }

    case "initialized":
      // Notification, no response.
      return undefined;

    case "tools/list": {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: { tools },
      };
    }

    case "tools/call": {
      return handleToolCall(request.id, request.params ?? {});
    }

    case "ping": {
      return { jsonrpc: "2.0", id: request.id, result: {} };
    }

    default:
      return makeError(request.id, -32601, `Method not found: ${request.method}`);
  }
}

function main(): void {
  logDebug("starting");

  const stdin = process.stdin;
  stdin.setEncoding("utf8");

  let buffer = "";
  stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch (err) {
        send(
          makeError(
            undefined,
            -32700,
            `Parse error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        continue;
      }

      const response = handleRequest(request);
      if (response) {
        send(response);
      }
    }
  });

  stdin.on("end", () => {
    logDebug("stdin closed");
  });
}

main();
