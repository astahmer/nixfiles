import { defineCli, cliCommand, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const providerSchema = z.enum(["codex", "opencode-go"]);
const accountSchema = z.object({
  provider: providerSchema,
  name: z.string().trim().min(1).max(48).regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u),
  path: z.string().min(1).max(1024).refine(
    (path) => path.startsWith("/") && !/[\u0000-\u001f\u007f]/u.test(path),
    "must be an absolute path without control characters",
  ),
});
const stateSchema = z.object({
  accounts: z.array(accountSchema).max(100),
  active: z.object({
    codex: z.string().optional(),
    "opencode-go": z.string().optional(),
  }).default({}),
});
type Provider = z.infer<typeof providerSchema>;
type Account = z.infer<typeof accountSchema>;

const stateKey = "accounts-v1";
const providerEnv: Record<Provider, { providerId: string; variable: string }> = {
  codex: { providerId: "codex", variable: "CODEX_HOME" },
  "opencode-go": { providerId: "acp-opencode", variable: "XDG_DATA_HOME" },
};

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export default async function plugin(bb: BbPluginApi) {
  const readState = async () => {
    const stored = await bb.storage.kv.get<unknown>(stateKey);
    if (stored === undefined) return { accounts: [], active: {} };
    const parsed = stateSchema.safeParse(stored);
    if (!parsed.success) throw new Error("Stored account profiles are invalid; remove and re-add the affected profiles.");
    return parsed.data;
  };

  const writeState = async (state: z.infer<typeof stateSchema>) => {
    await bb.storage.kv.set(stateKey, state);
  };

  const findAccount = (accounts: Account[], provider: Provider, name: string) =>
    accounts.find((account) => account.provider === provider && account.name === name);

  for (const provider of ["codex", "opencode-go"] as const) {
    const target = providerEnv[provider];
    bb.providers.experimental_contributeEnv(target.providerId, async () => {
      const state = await readState();
      const activeName = state.active[provider];
      if (activeName === undefined) return [];
      const account = findAccount(state.accounts, provider, activeName);
      if (account === undefined) return [];
      return [{
        name: target.variable,
        value: account.path,
        reason: `Use the ${provider} account profile selected in BB AI Accounts.`,
      }];
    });
  }

  bb.cli.register(defineCli({
    name: "ai-accounts",
    summary: "Manage separate Codex and OpenCode Go subscription logins",
    commands: {
      list: cliCommand({
        summary: "List account profile names and active selections",
        options: { json: { type: "boolean", description: "Emit JSON" } },
        async run(input) {
          const state = await readState();
          const accounts = state.accounts.map((account) => ({
            ...account,
            active: state.active[account.provider] === account.name,
          }));
          return {
            exitCode: 0,
            stdout: input.options.json
              ? JSON.stringify(accounts)
              : accounts.length === 0
                ? "No account profiles. Add one with `bb ai-accounts add`."
                : accounts.map((account) => `${account.active ? "*" : " "} ${account.provider} ${account.name} — ${account.path}`).join("\n"),
          };
        },
      }),
      add: cliCommand({
        summary: "Register a login directory for Codex or OpenCode Go",
        positionals: [
          { name: "provider", description: "codex or opencode-go", required: true },
          { name: "name", description: "Short account label", required: true },
          { name: "path", description: "Absolute account home path", required: true },
        ],
        async run(input) {
          const provider = providerSchema.safeParse(input.positionals.provider);
          const account = accountSchema.safeParse({
            provider: input.positionals.provider,
            name: input.positionals.name,
            path: input.positionals.path,
          });
          if (!provider.success || !account.success) {
            throw new PluginCliError("Use a provider of codex or opencode-go, a short label, and an absolute path.", {
              code: "invalid_account_profile",
              hint: "Use an absolute path, such as /absolute/path/codex/work.",
            });
          }
          const state = await readState();
          if (findAccount(state.accounts, account.data.provider, account.data.name) !== undefined) {
            throw new PluginCliError("That account profile already exists.", {
              code: "account_exists",
              hint: "Choose a new profile name or remove the existing profile first.",
            });
          }
          await writeState({ ...state, accounts: [...state.accounts, account.data] });
          return { exitCode: 0, stdout: `Added ${account.data.provider} profile ${account.data.name}. Run bb ai-accounts login ${account.data.provider} ${account.data.name} to sign in.` };
        },
      }),
      use: cliCommand({
        summary: "Select the account used by new BB sessions for a provider",
        positionals: [
          { name: "provider", description: "codex or opencode-go", required: true },
          { name: "name", description: "Account profile name", required: true },
        ],
        async run(input) {
          const provider = providerSchema.safeParse(input.positionals.provider);
          if (!provider.success) throw new PluginCliError("Unknown provider.", { code: "unknown_provider", hint: "Choose codex or opencode-go." });
          const state = await readState();
          const account = findAccount(state.accounts, provider.data, input.positionals.name);
          if (account === undefined) throw new PluginCliError("Account profile not found.", { code: "account_not_found", hint: "Run `bb ai-accounts list` to see registered profiles." });
          await writeState({ ...state, active: { ...state.active, [provider.data]: account.name } });
          return { exitCode: 0, stdout: `Selected ${account.provider} profile ${account.name}. Start a new BB session to use it.` };
        },
      }),
      login: cliCommand({
        summary: "Print the local sign-in command for an account profile",
        positionals: [
          { name: "provider", description: "codex or opencode-go", required: true },
          { name: "name", description: "Account profile name", required: true },
        ],
        async run(input) {
          const provider = providerSchema.safeParse(input.positionals.provider);
          if (!provider.success) throw new PluginCliError("Unknown provider.", { code: "unknown_provider", hint: "Choose codex or opencode-go." });
          const state = await readState();
          const account = findAccount(state.accounts, provider.data, input.positionals.name);
          if (account === undefined) throw new PluginCliError("Account profile not found.", { code: "account_not_found", hint: "Run `bb ai-accounts list` to see registered profiles." });
          const command = provider.data === "codex"
            ? `CODEX_HOME=${quote(account.path)} codex -c 'cli_auth_credentials_store="file"' login`
            : `XDG_DATA_HOME=${quote(account.path)} opencode auth login --provider opencode`;
          return { exitCode: 0, stdout: `Run this on each machine where you use the account:\n\n${command}\n\nThe plugin stores only the profile label and path. Authentication stays in the provider's own files.` };
        },
      }),
      remove: cliCommand({
        summary: "Remove an account profile without deleting local credentials",
        positionals: [
          { name: "provider", description: "codex or opencode-go", required: true },
          { name: "name", description: "Account profile name", required: true },
        ],
        async run(input) {
          const provider = providerSchema.safeParse(input.positionals.provider);
          if (!provider.success) throw new PluginCliError("Unknown provider.", { code: "unknown_provider", hint: "Choose codex or opencode-go." });
          const state = await readState();
          const remaining = state.accounts.filter((account) => account.provider !== provider.data || account.name !== input.positionals.name);
          if (remaining.length === state.accounts.length) throw new PluginCliError("Account profile not found.", { code: "account_not_found", hint: "Run `bb ai-accounts list` to see registered profiles." });
          const active = { ...state.active };
          if (active[provider.data] === input.positionals.name) delete active[provider.data];
          await writeState({ accounts: remaining, active });
          return { exitCode: 0, stdout: `Removed profile ${input.positionals.name}. Local provider credentials were left in place.` };
        },
      }),
    },
  }));
}
