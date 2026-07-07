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
import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";

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
    name: "submit_plan",
    description:
      "Open the Plannotator plan-review UI for an agent-generated plan. " +
      "Blocks until the user approves or denies, then returns the decision " +
      "and any feedback.",
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
            "Optional timeout. If the user does not respond in time, the tool " +
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
    name: "submit_review",
    description:
      "Open the Plannotator code-review UI for the current VCS changes or a " +
      "pull request. Blocks until the user submits feedback or dismisses.",
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
    name: "annotate",
    description:
      "Open the Plannotator annotation UI for a markdown file, HTML file, URL, " +
      "or folder. Blocks until the user submits annotations or dismisses.",
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
    name: "archive",
    description:
      "Open the Plannotator archive UI to browse saved plan decisions.",
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
    name: "sessions",
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

function handleSubmitPlan(
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

function handleSubmitReview(
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

function handleAnnotate(
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

function handleArchive(
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

function handleSessions(
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
    case "submit_plan":
      return handleSubmitPlan(id, args);
    case "submit_review":
      return handleSubmitReview(id, args);
    case "annotate":
      return handleAnnotate(id, args);
    case "archive":
      return handleArchive(id, args);
    case "sessions":
      return handleSessions(id, args);
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
