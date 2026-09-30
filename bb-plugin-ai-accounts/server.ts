import { defineCli, cliCommand, PluginCliError, defineRpcContract, type BbPluginApi, type JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readFile } from "node:fs/promises";

const providerSchema = z.enum(["codex", "opencode-go"]);
const accountSchema = z.object({
  id: z.string().uuid(),
  provider: providerSchema,
  displayName: z.string().trim().min(1).max(48).regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u),
  path: z.string().min(1).max(1024).refine(
    (path) => path.startsWith("/") && !/[\u0000-\u001f\u007f]/u.test(path),
    "must be an absolute path without control characters",
  ),
  email: z.string().email().optional(),
  enabled: z.boolean().default(true),
  hiddenModelIds: z.array(z.string().min(1).max(160)).max(500).default([]),
});
const stateSchema = z.object({ accounts: z.array(accountSchema).max(100) });
export type AccountProfile = z.infer<typeof accountSchema>;
type Account = AccountProfile;
type Provider = z.infer<typeof providerSchema>;

const stateKey = "accounts-v2";
const accountInputSchema = accountSchema.omit({ id: true }).extend({ id: z.string().uuid().optional() });
export const rpcContract = defineRpcContract({
  list: {
    input: z.null(),
    output: z.object({ accounts: z.array(accountSchema) }),
  },
  save: {
    input: accountInputSchema,
    output: z.object({ account: accountSchema }),
  },
  remove: {
    input: z.object({ id: z.string().uuid() }),
    output: z.object({ accounts: z.array(accountSchema) }),
  },
  identity: {
    input: z.object({ id: z.string().uuid() }),
    output: z.object({ email: z.string().email().nullable() }),
  },
});

const providerDisplayNames: Record<Provider, string> = {
  codex: "Codex",
  "opencode-go": "OpenCode Go",
};

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

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
  const syncProviders = async () => {
    for (const registration of registrations.values()) registration.dispose();
    registrations.clear();
    const { accounts } = await readState();
    for (const account of accounts.filter((profile) => profile.enabled)) {
      const displayName = providerDisplayNames[account.provider] + " · " + account.displayName;
      const launchEnv: Record<string, string> = account.provider === "codex"
        ? { CODEX_HOME: account.path }
        : { XDG_DATA_HOME: account.path };
      const launchCommand = account.provider === "codex" ? "npx" : "opencode";
      const launchArgs = account.provider === "codex" ? ["--yes", "@agentclientprotocol/codex-acp@2.0.1"] : ["acp"];
      const launch: JsonValue = { displayName, command: launchCommand, args: launchArgs, env: launchEnv };
      registrations.set(account.id, bb.providers.register({
        id: "ai-account-" + account.id.replaceAll("-", "").slice(0, 24),
        displayName,
        family: account.provider === "codex" ? "codex" : "opencode-go",
        icon: account.provider === "codex" ? "Bot" : "Sparkles",
        strings: {
          signInHint: account.provider === "codex"
            ? "Select " + displayName + ", then choose ChatGPT sign-in. This profile stores its login under " + account.path + "."
            : "Select " + displayName + ", then run OpenCode auth login to connect your OpenCode Go key. Credentials stay in this OpenCode data directory.",
          expiredHint: "Reauthenticate this account from AI Accounts, then retry the session.",
          installUrl: account.provider === "codex" ? "https://github.com/agentclientprotocol/codex-acp" : "https://opencode.ai/docs/go/",
          brandPrefix: account.provider === "codex" ? "Codex " : "OpenCode ",
          iconTint: account.provider === "codex"
            ? { light: "#2563EB", dark: "#60A5FA" }
            : { light: "#7C3AED", dark: "#C4B5FD" },
        },
        experimental_bridgeOptions: {
          acpLaunchSpec: launch,
          acpDialect: "generic",
          accountId: account.id,
          hiddenModelIds: account.hiddenModelIds,
        },
        capabilities: {
          supportsServiceTier: false,
          supportsNativeUserQuestion: true,
          fork: "tip",
          supportsManualCompaction: true,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ["full", "accept-edits"],
          reasoningLevels: ["low", "medium", "high"],
        },
        composerActions: [],
        models: { scope: "host" },
        env: { passthrough: [] },
      }));
    }
  };

  await syncProviders();
  bb.rpc.register(rpcContract, {
    async list() {
      const { accounts } = await readState();
      return { accounts };
    },
    async save(input) {
      const normalized = accountInputSchema.parse(input);
      const { accounts } = await readState();
      const id = normalized.id ?? crypto.randomUUID();
      const account: Account = accountSchema.parse({ ...normalized, id });
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
    async identity({ id }) {
      const { accounts } = await readState();
      const account = accounts.find((profile) => profile.id === id);
      if (account === undefined || account.provider !== "codex") return { email: account?.email ?? null };
      try {
        const authFile = await readFile(account.path + "/auth.json", "utf8");
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
              ? JSON.stringify(accounts.map(({ id: _id, ...account }) => account))
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
            ? "CODEX_HOME=" + quote(account.path) + " codex login"
            : "XDG_DATA_HOME=" + quote(account.path) + " opencode auth login";
          return { exitCode: 0, stdout: "Run this in a terminal to sign in to " + account.displayName + ":\n\n" + command };
        },
      }),
    },
  }));
}
