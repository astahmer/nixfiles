import { defineCli, cliCommand, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { aliasSchema, hostContract, locationSchema, rpcContract } from "./contract";

const hostSchema = z.string().min(1).max(256);
const environmentSchema = z.string().trim().min(1).max(128).default("prod");

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const location = (cwd: string, hostId: string) => {
    const parsed = locationSchema.safeParse({ cwd, hostId });
    if (!parsed.success) {
      throw new PluginCliError("Use an absolute working directory and a valid BB host ID.", {
        code: "invalid_secret_location",
        hint: "For example: bb secret-catalog list /Users/me/dev/project --host <host-id>",
      });
    }
    return parsed.data;
  };
  const threadLocation = async (threadId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId)
      throw new Error("This thread has no execution environment attached.");
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if (
      environment.status !== "ready" ||
      environment.lifecycle.phase !== "active" ||
      !environment.path
    ) {
      throw new Error("This thread's execution environment is not ready.");
    }
    return location(environment.path, environment.hostId);
  };

  bb.rpc.register(rpcContract, {
    list: async (input) =>
      host.call("list", { cwd: input.cwd, scope: input.scope }, { hostId: input.hostId }),
    get: async (input) =>
      host.call(
        "get",
        { cwd: input.cwd, alias: input.alias, environment: input.environment, scope: input.scope },
        { hostId: input.hostId },
      ),
    copy: async (input) =>
      host.call(
        "copy",
        { cwd: input.cwd, alias: input.alias, environment: input.environment, scope: input.scope },
        { hostId: input.hostId },
      ),
    set: async (input) =>
      host.call(
        "set",
        {
          cwd: input.cwd,
          alias: input.alias,
          value: input.value,
          environment: input.environment,
          scope: input.scope,
          itemType: input.itemType,
        },
        { hostId: input.hostId },
      ),
    rename: async (input) =>
      host.call(
        "rename",
        { cwd: input.cwd, alias: input.alias, newAlias: input.newAlias, scope: input.scope },
        { hostId: input.hostId },
      ),
    unset: async (input) =>
      host.call(
        "unset",
        { cwd: input.cwd, alias: input.alias, scope: input.scope },
        { hostId: input.hostId },
      ),
  });

  bb.agents.registerTool({
    name: "secret_list",
    description: "List configured secret aliases and metadata without retrieving any values.",
    instructions:
      "Use secret_list before asking the user to configure a credential. This tool never returns values.",
    parameters: z.object({}),
    async execute(_input, context) {
      const where = await threadLocation(context.threadId);
      const result = await host.call(
        "list",
        { cwd: where.cwd, scope: "all" },
        { hostId: where.hostId, signal: context.signal, timeoutMs: 55_000 },
      );
      return JSON.stringify(result.entries);
    },
  });

  bb.agents.registerTool({
    name: "secret_get",
    description: "Retrieve one configured secret value from the local secret CLI.",
    instructions:
      "Call only when a secret is needed for the current task. Returned value enters the agent context; do not repeat it in chat, logs, or files unless the user explicitly asks.",
    parameters: z.object({ alias: aliasSchema, environment: environmentSchema }),
    async execute(input, context) {
      const where = await threadLocation(context.threadId);
      const result = await host.call(
        "get",
        { cwd: where.cwd, alias: input.alias, environment: input.environment },
        { hostId: where.hostId, signal: context.signal, timeoutMs: 55_000 },
      );
      return result.value;
    },
  });

  bb.agents.configure(() => ({
    tools: ["secret_list", "secret_get"],
    skills: ["secret-catalog"],
    instructions:
      "Secret Catalog agent tools are restricted to this thread's active execution environment. Use secret_list to discover aliases, then secret_get only when the current task needs a value.",
  }));

  bb.cli.register(
    defineCli({
      name: "secret-catalog",
      summary: "Browse configured secret aliases and retrieve one value through the secret CLI",
      commands: {
        list: cliCommand({
          summary: "List configured aliases without values",
          positionals: [
            {
              name: "cwd",
              description: "Absolute directory containing the project's secret config",
              required: true,
            },
          ],
          options: { host: { type: "string", description: "BB host ID" } },
          async run(input) {
            const hostId = hostSchema.safeParse(input.options.host);
            if (!hostId.success)
              throw new PluginCliError("A valid --host is required.", {
                code: "missing_host",
                hint: "Run with --host <host-id>.",
              });
            const result = await host.call(
              "list",
              { cwd: location(input.positionals.cwd, hostId.data).cwd, scope: "all" },
              { hostId: hostId.data },
            );
            return { exitCode: 0, stdout: JSON.stringify(result.entries, null, 2) };
          },
        }),
        get: cliCommand({
          summary: "Retrieve one configured secret value",
          positionals: [
            { name: "cwd", description: "Absolute project directory", required: true },
            { name: "alias", description: "Configured secret alias", required: true },
          ],
          options: {
            host: { type: "string", description: "BB host ID" },
            env: { type: "string", description: "Secret environment (defaults to prod)" },
          },
          async run(input) {
            const hostId = hostSchema.safeParse(input.options.host);
            const alias = aliasSchema.safeParse(input.positionals.alias);
            const environment = environmentSchema.safeParse(input.options.env);
            if (!hostId.success || !alias.success || !environment.success) {
              throw new PluginCliError("A valid --host, alias, and environment are required.", {
                code: "invalid_secret_target",
                hint: "Run with --host <host-id> and a configured alias.",
              });
            }
            const where = location(input.positionals.cwd, hostId.data);
            const result = await host.call(
              "get",
              { cwd: where.cwd, alias: alias.data, environment: environment.data },
              { hostId: where.hostId },
            );
            return { exitCode: 0, stdout: result.value };
          },
        }),
      },
    }),
  );
}
