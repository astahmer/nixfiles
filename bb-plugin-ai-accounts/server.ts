import { defineCli, cliCommand, PluginCliError, defineRpcContract, type BbPluginApi, type JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

const providerSchema = z.enum(["codex", "opencode-go"]);
const accountSchema = z.object({
  id: z.string().min(1).max(48).regex(/^[a-z0-9][a-z0-9-]*$/u),
  provider: providerSchema,
  displayName: z.string().trim().min(1).max(48).regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u),
  badge: z.string().trim().min(1).max(4).transform((value) => value.toUpperCase()).optional(),
  accentColor: z.string().regex(/^#[\da-fA-F]{6}$/u).optional(),
  path: z.string().min(1).max(1024).refine(
    (path) => path.startsWith("/") && !/[\u0000-\u001f\u007f]/u.test(path),
    "must be an absolute path without control characters",
  ),
  pathOverrides: z.array(z.object({
    projectId: z.string().min(1).nullable(),
    hostId: z.string().min(1).nullable(),
    path: z.string().min(1).max(1024).refine(
      (path) => path.startsWith("/") && !/[\u0000-\u001f\u007f]/u.test(path),
      "must be an absolute path without control characters",
    ),
  })).max(100).default([]),
  email: z.string().email().optional(),
  enabled: z.boolean().default(true),
  hiddenModelIds: z.array(z.string().min(1).max(160)).max(500).default([]),
  favoriteModelIds: z.array(z.string().min(1).max(160)).max(500).default([]),
  modelOrder: z.array(z.string().min(1).max(160)).max(500).default([]),
  modelReasoningDefaults: z.record(z.string().min(1).max(160), z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"])).refine(
    (defaults) => Object.keys(defaults).length <= 500,
    "Model reasoning defaults cannot contain more than 500 entries.",
  ).default({}),
  customModels: z.array(z.object({
    id: z.string().trim().min(1).max(160).refine((id) => !/[\u0000-\u001f\u007f]/u.test(id)),
    displayName: z.string().trim().min(1).max(80).refine((name) => !/[\u0000-\u001f\u007f]/u.test(name)),
  })).max(100).default([]).refine(
    (models) => new Set(models.map((model) => model.id)).size === models.length,
    "Custom model IDs must be unique.",
  ),
});
const stateSchema = z.object({ accounts: z.array(accountSchema).max(100) }).refine(
  (state) => new Set(state.accounts.map((account) => account.id)).size === state.accounts.length,
  "Account profile IDs must be unique.",
);
export type AccountProfile = z.infer<typeof accountSchema>;
type Account = AccountProfile;
type Provider = z.infer<typeof providerSchema>;

const stateKey = "accounts-v2";
const accountInputSchema = accountSchema.omit({ id: true }).extend({ id: accountSchema.shape.id.optional() });
const accountIdSchema = accountSchema.shape.id;
export const rpcContract = defineRpcContract({
  defaults: {
    input: z.null(),
    output: z.object({ codex: z.string(), opencodeGo: z.string() }),
  },
  machines: {
    input: z.null(),
    output: z.object({ machines: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })) }),
  },
  catalog: {
    input: z.object({ id: accountIdSchema, hostId: z.string().min(1) }),
    output: z.object({ models: z.array(z.object({
      id: z.string(), displayName: z.string(), isDefault: z.boolean(),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]), description: z.string() })),
      defaultReasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]),
    })) }),
  },
  list: {
    input: z.null(),
    output: z.object({ accounts: z.array(accountSchema) }),
  },
  save: {
    input: accountInputSchema,
    output: z.object({ account: accountSchema }),
  },
  remove: {
    input: z.object({ id: accountIdSchema }),
    output: z.object({ accounts: z.array(accountSchema) }),
  },
  identity: {
    input: z.object({ id: accountIdSchema, path: accountSchema.shape.path.optional() }),
    output: z.object({ email: z.string().email().nullable() }),
  },
});

const providerDisplayNames: Record<Provider, string> = {
  codex: "Codex",
  "opencode-go": "OpenCode Go",
};

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const badgeFor = (displayName: string, provider: Provider) => {
  const initials = displayName.split(/\s+/u).filter(Boolean).map((part) => part[0]).join("").slice(0, 3);
  return initials || (provider === "codex" ? "CDX" : "OCG");
};
const colorFor = (id: string, provider: Provider) => {
  const palette = provider === "codex"
    ? ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#7C3AED", "#0891B2"]
    : ["#7C3AED", "#C026D3", "#DB2777", "#EA580C", "#4F46E5", "#0D9488"];
  const index = [...id].reduce((total, character) => total + character.charCodeAt(0), 0) % palette.length;
  return palette[index];
};

const runBb = (args: string[]) => new Promise<string>((resolve, reject) => {
  execFile(process.env.BB_CLI ?? "bb", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 }, (error, stdout) => {
    if (error) {
      reject(new Error("BB command failed."));
      return;
    }
    resolve(stdout);
  });
});

const accountPathFor = (account: Account, projectId: string | null, hostId: string) => {
  const matches = account.pathOverrides.filter((override) =>
    (override.projectId === null || override.projectId === projectId) &&
    (override.hostId === null || override.hostId === hostId),
  );
  matches.sort((left, right) =>
    Number(right.projectId !== null) + Number(right.hostId !== null) -
    Number(left.projectId !== null) - Number(left.hostId !== null),
  );
  return matches[0]?.path ?? account.path;
};

const tokenEmail = (auth: unknown) => {
  const result = z.object({ tokens: z.object({ id_token: z.string().optional() }).optional() }).safeParse(auth);
  const token = result.success ? result.data.tokens?.id_token : undefined;
  const payload = token?.split(".")[1];
  if (payload === undefined) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const claims = z.object({ email: z.string().email() }).safeParse(decoded);
    return claims.success ? claims.data.email : null;
  } catch {
    return null;
  }
};

export default async function plugin(bb: BbPluginApi) {
  const readState = async () => {
    const stored = await bb.storage.kv.get<unknown>(stateKey);
    if (stored === undefined) return { accounts: [] };
    const parsed = stateSchema.safeParse(stored);
    if (!parsed.success) throw new Error("Stored account profiles are invalid; edit or remove the affected profiles.");
    return parsed.data;
  };

  const registrations = new Map<string, { dispose(): void }>();
  const environmentContributions = new Set<string>();
  const syncProviders = async () => {
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
    const { accounts } = await readState();
    for (const account of accounts.filter((profile) => profile.enabled)) {
      const accountBadge = account.badge ?? badgeFor(account.displayName, account.provider);
      const displayName = accountBadge + " · " + account.displayName;
      const launchCommand = account.provider === "codex" ? "npx" : "opencode";
      const launchArgs = account.provider === "codex" ? ["--yes", "@agentclientprotocol/codex-acp@2.0.1"] : ["acp"];
      const launch: JsonValue = { displayName, command: launchCommand, args: launchArgs, env: {} };
      const providerId = "ai-account-" + account.id;
      registrations.set(account.id, bb.providers.register({
        id: providerId,
        displayName,
        family: account.provider === "codex" ? "codex" : "opencode-go",
        icon: "./icons/account.svg",
        strings: {
          signInHint: account.provider === "codex"
            ? "Select " + displayName + ", then choose ChatGPT sign-in. This profile stores its login under " + account.path + "."
            : "Select " + displayName + ", then run OpenCode auth login to connect your OpenCode Go key. Credentials stay in this OpenCode data directory.",
          expiredHint: "Reauthenticate this account from AI Accounts, then retry the session.",
          installUrl: account.provider === "codex" ? "https://github.com/agentclientprotocol/codex-acp" : "https://opencode.ai/docs/go/",
          brandPrefix: account.provider === "codex" ? "Codex " : "OpenCode ",
          iconTint: { light: account.accentColor ?? colorFor(account.id, account.provider), dark: account.accentColor ?? colorFor(account.id, account.provider) },
        },
        experimental_bridgeOptions: {
          acpLaunchSpec: launch,
          acpDialect: "generic",
          accountId: account.id,
          accountProvider: account.provider,
          accountDisplayName: account.displayName,
          accountBadge,
          hiddenModelIds: account.hiddenModelIds,
          favoriteModelIds: account.favoriteModelIds,
          modelOrder: account.modelOrder,
          modelReasoningDefaults: account.modelReasoningDefaults,
          customModels: account.customModels,
        },
        maintenance: { usage: true },
        capabilities: {
          supportsServiceTier: false,
          supportsNativeUserQuestion: true,
          fork: "tip",
          supportsManualCompaction: true,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ["full", "accept-edits"],
          reasoningLevels: account.provider === "codex"
            ? ["low", "medium", "high", "xhigh", "max", "ultra"]
            : ["low", "medium", "high"],
        },
        composerActions: [],
        models: { scope: "host" },
        env: { passthrough: [account.provider === "codex" ? "CODEX_HOME" : "XDG_DATA_HOME"] },
      }));
      const variable = account.provider === "codex" ? "CODEX_HOME" : "XDG_DATA_HOME";
      if (!environmentContributions.has(providerId)) {
        bb.providers.experimental_contributeEnv(providerId, async (context) => {
          const current = await readState();
          const configured = current.accounts.find((profile) => profile.id === account.id);
          if (configured === undefined || !configured.enabled) return [];
          return [{
            name: variable,
            value: accountPathFor(configured, context.projectId, context.hostId),
            reason: "Use the account path configured for this project and machine in AI Accounts.",
          }];
        });
        environmentContributions.add(providerId);
      }
    }
  };

  await syncProviders();
  bb.rpc.register(rpcContract, {
    defaults() {
      const root = join(homedir(), ".local", "share", "bb-ai-accounts");
      return { codex: join(root, "codex"), opencodeGo: join(root, "opencode") };
    },
    async machines() {
      try {
        const result: unknown = JSON.parse(await runBb(["machine", "list", "--json"]));
        const decoded = z.array(z.object({ id: z.string(), name: z.string(), status: z.string() }).passthrough()).safeParse(result);
        if (!decoded.success) return { machines: [] };
        return { machines: decoded.data.map(({ id, name, status }) => ({ id, name, status })) };
      } catch {
        return { machines: [] };
      }
    },
    async catalog({ id, hostId }) {
      const { accounts } = await readState();
      const account = accounts.find((profile) => profile.id === id);
      if (account === undefined || !account.enabled) return { models: [] };
      const providerId = account.provider === "codex" ? "codex" : "ai-account-" + account.id;
      try {
        const result: unknown = JSON.parse(await runBb(["provider", "models", providerId, "--host", hostId, "--json"]));
        const decoded = z.array(z.object({
          id: z.string(),
          displayName: z.string(),
          isDefault: z.boolean(),
          supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]), description: z.string() })),
          defaultReasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "ultracode", "max", "ultra"]),
        }).passthrough()).safeParse(result);
        if (!decoded.success) return { models: [] };
        const accountBadge = account.badge ?? badgeFor(account.displayName, account.provider);
        return { models: decoded.data.filter((model) => !model.id.startsWith("codex-perso/")).map(({ id: modelId, displayName, isDefault, supportedReasoningEfforts, defaultReasoningEffort }) => ({
          id: modelId,
          displayName: displayName.endsWith(" · " + accountBadge) ? displayName.slice(0, -accountBadge.length - 3) : displayName,
          isDefault,
          supportedReasoningEfforts,
          defaultReasoningEffort,
        })) };
      } catch {
        return { models: [] };
      }
    },
    async list() {
      const { accounts } = await readState();
      return { accounts };
    },
    async save(input) {
      const normalized = accountInputSchema.parse(input);
      const { accounts } = await readState();
      const id = normalized.id ?? crypto.randomUUID();
      const account: Account = accountSchema.parse({
        ...normalized,
        id,
        badge: normalized.badge ?? badgeFor(normalized.displayName, normalized.provider),
        accentColor: normalized.accentColor ?? colorFor(id, normalized.provider),
      });
      const next = accounts.some((saved) => saved.id === id)
        ? accounts.map((saved) => saved.id === id ? account : saved)
        : [...accounts, account];
      await bb.storage.kv.set(stateKey, { accounts: next });
      await syncProviders();
      return { account };
    },
    async remove({ id }) {
      const { accounts } = await readState();
      const next = accounts.filter((account) => account.id !== id);
      await bb.storage.kv.set(stateKey, { accounts: next });
      await syncProviders();
      return { accounts: next };
    },
    async identity({ id, path }) {
      const { accounts } = await readState();
      const account = accounts.find((profile) => profile.id === id);
      if (account === undefined || account.provider !== "codex") return { email: account?.email ?? null };
      try {
        const authFile = await readFile((path ?? account.path) + "/auth.json", "utf8");
        const email = tokenEmail(JSON.parse(authFile));
        if (email === null) return { email: account.email ?? null };
        const next = accounts.map((profile) => profile.id === id ? { ...profile, email } : profile);
        await bb.storage.kv.set(stateKey, { accounts: next });
        return { email };
      } catch {
        return { email: account.email ?? null };
      }
    },
  });

  bb.cli.register(defineCli({
    name: "ai-accounts",
    summary: "Manage Codex and OpenCode Go accounts for BB",
    commands: {
      list: cliCommand({
        summary: "List registered AI accounts",
        options: { json: { type: "boolean", description: "Emit JSON" } },
        async run(input) {
          const { accounts } = await readState();
          return {
            exitCode: 0,
            stdout: input.options.json
              ? JSON.stringify(accounts)
              : accounts.length === 0
                ? "No accounts yet. Open AI Accounts in BB to add one."
                : accounts.map((account) => (account.enabled ? "● " : "○ ") + providerDisplayNames[account.provider] + " · " + account.displayName + (account.email ? " (" + account.email + ")" : "") + " — " + account.path).join("\n"),
          };
        },
      }),
      login: cliCommand({
        summary: "Print a sign-in command for an account",
        positionals: [{ name: "id", description: "Account id", required: true }],
        async run(input) {
          const { accounts } = await readState();
          const account = accounts.find((profile) => profile.id === input.positionals.id);
          if (account === undefined) throw new PluginCliError("Account not found.", { code: "account_not_found" });
          const command = account.provider === "codex"
            ? "mkdir -p " + quote(account.path) + " && chmod 700 " + quote(account.path) + " && CODEX_HOME=" + quote(account.path) + " codex login"
            : "mkdir -p " + quote(account.path) + " && XDG_DATA_HOME=" + quote(account.path) + " opencode auth login";
          return { exitCode: 0, stdout: "Run this in a terminal to sign in to " + account.displayName + ":\n\n" + command };
        },
      }),
      remove: cliCommand({
        summary: "Remove a BB account profile without deleting its credentials",
        positionals: [{ name: "id", description: "Account id", required: true }],
        async run(input) {
          const { accounts } = await readState();
          const next = accounts.filter((account) => account.id !== input.positionals.id);
          if (next.length === accounts.length) throw new PluginCliError("Account not found.", { code: "account_not_found" });
          await bb.storage.kv.set(stateKey, { accounts: next });
          await syncProviders();
          return { exitCode: 0, stdout: "Profile removed. Provider credential files were left in place." };
        },
      }),
      sync: cliCommand({
        summary: "Replace account profiles from a declarative JSON file",
        positionals: [{ name: "path", description: "Path to an accounts JSON file", required: true }],
        async run(input) {
          let document: unknown;
          try {
            document = JSON.parse(await readFile(input.positionals.path, "utf8"));
          } catch {
            throw new PluginCliError("Could not read or parse the accounts file.", { code: "invalid_accounts_file" });
          }
          const parsed = stateSchema.safeParse(document);
          if (!parsed.success) throw new PluginCliError("Accounts file must contain a valid accounts array.", { code: "invalid_accounts_file" });
          await bb.storage.kv.set(stateKey, parsed.data);
          await syncProviders();
          return { exitCode: 0, stdout: "Synchronized " + parsed.data.accounts.length + " profiles." };
        },
      }),
    },
  }));
}
