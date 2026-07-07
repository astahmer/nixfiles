#!/usr/bin/env node
// Seeder script for the local Executor catalog.
// Idempotent: safe to re-run after home-manager switch.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const EXECUTOR_DIR = path.join(homedir(), ".executor");
const EXECUTOR_AUTH_DIR = process.env.XDG_DATA_HOME
  ? path.join(process.env.XDG_DATA_HOME, "executor")
  : path.join(homedir(), ".local", "share", "executor");
const EXECUTOR_AUTH_FILE = path.join(EXECUTOR_AUTH_DIR, "auth.json");
const GITHUB_TOKEN_FILE = path.join(homedir(), ".config", "opencode", "github-token");

process.env.EXECUTOR_SCOPE_DIR = EXECUTOR_DIR;

if (!commandExists("executor")) {
  console.error("executor is not on PATH. Install it first (home-manager activation handles this).");
  process.exit(1);
}

function ensureExecutorDirs(): void {
  mkdirSync(EXECUTOR_DIR, { recursive: true });
  mkdirSync(EXECUTOR_AUTH_DIR, { recursive: true });
}

function commandExists(command: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function readText(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, "utf8").trim();
}

function writeText(filePath: string, content: string): void {
  writeFileSync(filePath, content, { mode: 0o600 });
}

function getActiveExecutorBaseUrl(): string | undefined {
  try {
    const daemonFile = path.join(EXECUTOR_DIR, "daemon-localhost-4789.json");
    if (!existsSync(daemonFile)) return undefined;
    const daemon = JSON.parse(readFileSync(daemonFile, "utf8")) as {
      port?: number;
      pid?: number;
    };
    if (!daemon.port || !daemon.pid) return undefined;
    // Best-effort liveness check; if the PID is gone, fall back to auto-start.
    try {
      process.kill(daemon.pid, 0);
    } catch {
      return undefined;
    }
    return `http://localhost:${daemon.port}`;
  } catch {
    return undefined;
  }
}

function withBaseUrl(args: string[], baseUrl: string | undefined): string[] {
  if (!baseUrl) return args;
  // Executor expects the global --base-url flag after the subcommand:
  //   executor call --base-url <url> ...
  //   executor resume --base-url <url> ...
  if (args[0] === "call" || args[0] === "resume") {
    return [args[0], "--base-url", baseUrl, ...args.slice(1)];
  }
  return args;
}

function runExecutor(args: string[]): string {
  const baseUrl = getActiveExecutorBaseUrl();
  return execFileSync("executor", withBaseUrl(args, baseUrl), { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function extractJson(output: string): unknown {
  const match = output.trim().match(/\{[\s\S]*\}$/);
  if (!match) throw new Error("No JSON object found in output");
  return JSON.parse(match[0]);
}

function resumeIfPaused(output: string): void {
  const match = output.match(/executionId: (exec_[A-Za-z0-9-]+)/);
  if (!match) return;

  const executionId = match[1];
  const baseUrl = getActiveExecutorBaseUrl();
  console.error(`Auto-resuming execution ${executionId}`);
  execFileSync(
    "executor",
    withBaseUrl(
      [
        "resume",
        "--execution-id",
        executionId,
        "--action",
        "accept",
        "--content",
        "{}",
      ],
      baseUrl,
    ),
    { stdio: "inherit" },
  );
}

function callExecutor(toolPath: string, payload: Record<string, unknown>): void {
  let output: string;
  try {
    output = runExecutor(["call", toolPath, JSON.stringify(payload)]);
  } catch (error) {
    output = String((error as { stderr?: string }).stderr ?? "");
  }

  console.log(output.trimEnd());
  resumeIfPaused(output);
}

function listIntegrations(query: string): Array<{ slug: string }> {
  const output = runExecutor(["call", "executor.coreTools.integrations.list", JSON.stringify({ query })]);
  const data = extractJson(output) as { data?: { integrations?: Array<{ slug: string }> } };
  return data.data?.integrations ?? [];
}

function listConnections(integration: string): Array<{ integration: string }> {
  const output = runExecutor([
    "call",
    "executor.coreTools.connections.list",
    JSON.stringify({ integration }),
  ]);
  const data = extractJson(output) as { data?: { connections?: Array<{ integration: string }> } };
  return data.data?.connections ?? [];
}

function integrationExists(slug: string): boolean {
  return listIntegrations(slug).some((integration) => integration.slug === slug);
}

function connectionExists(integration: string): boolean {
  return listConnections(integration).some((connection) => connection.integration === integration);
}

function seedGithubToken(): string | undefined {
  const token =
    readText(GITHUB_TOKEN_FILE) ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    (commandExists("gh") ? execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() : undefined);

  if (!token) {
    console.error("No GitHub token found; skipping GitHub Copilot connection.");
    return undefined;
  }

  const current = readText(EXECUTOR_AUTH_FILE) ?? "{}";
  const updated = { ...JSON.parse(current), "github-token": token };
  writeText(EXECUTOR_AUTH_FILE, JSON.stringify(updated, null, 2));
  return token;
}

function addGithub(): void {
  if (integrationExists("github")) {
    console.log("GitHub Copilot integration already exists; skipping add.");
  } else {
    callExecutor("executor.mcp.addServer", {
      transport: "remote",
      name: "GitHub Copilot",
      slug: "github",
      endpoint: "https://api.githubcopilot.com/mcp/",
      remoteTransport: "auto",
      authenticationTemplate: [
        {
          type: "apiKey",
          headers: {
            Authorization: [{ type: "variable", name: "token" }],
          },
        },
      ],
    });
  }

  seedGithubToken();

  if (connectionExists("github")) {
    console.log("GitHub Copilot connection already exists; skipping create.");
  } else {
    callExecutor("executor.coreTools.connections.create", {
      owner: "org",
      name: "default",
      integration: "github",
      template: "default",
      inputs: {
        token: { from: { provider: "file", id: "github-token" } },
      },
    });
  }
}

function addContext7(): void {
  if (integrationExists("context7")) {
    console.log("Context7 integration already exists; skipping add.");
    return;
  }

  if (process.env.CONTEXT7_API_KEY) {
    callExecutor("executor.mcp.addServer", {
      transport: "stdio",
      name: "Context7",
      slug: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@1.0.31"],
      env: { CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY },
    });
    return;
  }

  callExecutor("executor.mcp.addServer", {
    transport: "remote",
    name: "Context7",
    slug: "context7",
    endpoint: "https://mcp.context7.com/mcp",
    remoteTransport: "auto",
    authenticationTemplate: [{ kind: "none" }],
  });

  if (!connectionExists("context7")) {
    callExecutor("executor.coreTools.connections.create", {
      owner: "org",
      name: "default",
      integration: "context7",
      template: "none",
    });
  }
}

function addChromeDevtools(): void {
  if (integrationExists("chrome-devtools")) {
    console.log("Chrome DevTools integration already exists; skipping add.");
    return;
  }

  callExecutor("executor.mcp.addServer", {
    transport: "stdio",
    name: "Chrome DevTools",
    slug: "chrome-devtools",
    command: "npx",
    args: ["-y", "chrome-devtools-mcp"],
  });
}

function getMcpServerCommand(slug: string): string | undefined {
  try {
    const output = runExecutor(["call", "executor.mcp.getServer", JSON.stringify({ slug })]);
    const data = extractJson(output) as {
      data?: {
        integration?: {
          config?: {
            command?: string;
            args?: string[];
          };
        };
      };
    };
    const config = data.data?.integration?.config;
    if (!config) return undefined;
    return [config.command, ...(config.args ?? [])].filter(Boolean).join(" ");
  } catch {
    return undefined;
  }
}

function addPlannotator(): void {
  const existingCommand = getMcpServerCommand("plannotator");
  if (existingCommand === "plannotator-mcp") {
    console.log("Plannotator integration already uses plannotator-mcp; skipping add.");
    return;
  }

  callExecutor("executor.mcp.addServer", {
    transport: "stdio",
    name: "Plannotator",
    slug: "plannotator",
    command: "plannotator-mcp",
  });
}

function addNixos(): void {
  if (integrationExists("nixos")) {
    console.log("nixos integration already exists; skipping add.");
    return;
  }

  callExecutor("executor.mcp.addServer", {
    transport: "stdio",
    name: "nixos",
    slug: "nixos",
    command: "uvx",
    args: ["mcp-nixos"],
  });
}

function main(): void {
  ensureExecutorDirs();
  addGithub();
  addContext7();
  addChromeDevtools();
  addPlannotator();
  addNixos();
  console.log("Executor integrations seeded.");
}

main();
