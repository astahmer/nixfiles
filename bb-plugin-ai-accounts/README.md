# BB AI Accounts

AI Accounts provides a BB page for separate Codex ChatGPT and OpenCode Go
profiles. Each enabled profile contributes a provider entry, with a short
account tag and color in the model picker.

## Sign in and choose models

Open **AI Accounts**, select or add a profile, then use **Copy sign-in
command** on the machine that runs its provider. The Codex command creates the
profile's `CODEX_HOME` before running `codex login`; sign in once for each
separate Codex account, then refresh to read the email claim from its local
`auth.json`. The command does not copy or expose credentials.
While a Codex profile is selected and has no detected email, the page checks
its account home periodically. Once the login writes `auth.json`, BB updates
the email and reloads that profile's live model catalog; **Refresh** remains
available for an immediate check.

OpenCode Go uses a separate `XDG_DATA_HOME` and its `opencode auth login` flow.
Credentials stay in OpenCode's own auth file.

The model section reads the complete Codex catalog or the selected OpenCode
Go provider catalog. It supports favorites, visibility checkboxes, order,
custom entries, and per-model default reasoning effort. The account-wide
**All models** composer action opens on a searchable view of every enabled
account, with provider tabs for narrower searches; BB's provider picker stays
available beside it. Account tags and colors are configurable.

Runtime paths inherit from the all-projects/all-machines default; project and
machine-specific paths override it. Nix owns profile names, paths, tags,
colors, and reasoning defaults. Model visibility, favorites, order, and custom
models can be edited in the page.

## Usage history

Open **AI Accounts → Usage** to see each configured account's current quota
windows, remaining percentages, reset times, token activity, and collection
status. The page supports 24-hour, 7-day, 30-day, and 90-day ranges, account and
machine filters, and an explicit refresh. The sidebar footer disclosure shows
the two most constrained current windows and links to the full page.

Quota values come from the existing Codex and OpenCode Go usage readers through
BB's provider usage API. The plugin stores a snapshot every five minutes for
connected machines and shows the provider's used percentage and the calculated
`100 - usedPercent` remaining value separately. A failed poll preserves the
last snapshot and marks it stale.

Token history combines BB `thread/tokenUsage/updated` events with provider-local
history where it can be tied to a configured profile. BB history is backfilled
from the thread event store, including archived threads. On the primary local
machine, Codex reads token-count fields from session JSONL files under the
configured `CODEX_HOME`; OpenCode reads completed assistant token records from
the configured OpenCode SQLite database. These sources retain model, timestamp,
token totals, and provenance. They do not copy prompts, transcript text,
credentials, or raw provider responses. Local history that cannot be read or
recognized is reported as unavailable or partial; the page does not invent a
profile attribution. The first refresh can need repeated bounded scans to
catch up with large local histories.

Usage history is stored in the plugin's local SQLite database. Quota snapshots
are retained for 90 days and token events for one year. Token counts are
provider-reported facts when the source includes them; they are not the user's
subscription bill or a conversion from quota percentages. This release does
not estimate API cost.

The host-owned BB Usage page cannot currently be extended with plugin content
through the public plugin API. This plugin's Usage page and footer disclosure
are additive. If you want only the AI Accounts shortcut in the footer, hide BB's
**Provider usage** shortcut in **Settings → Appearance → Sidebar footer → Show
Provider usage in footer**. This remains a user preference; the plugin does not
change it. The plugin does not use Tokitoki, OpenCodex, its management API, or
its account mapping.

## Nix setup

`modules/ai-accounts.nix` exposes `programs.bbAiAccounts` and wires it into the
macOS Home Manager profile. Defaults seed three Codex profiles and the existing
OpenCode Go Alex, Manu, and Mathias `secret` aliases. Apply Home Manager to
install the plugin and seed profiles. A Codex secret alias may contain the full
`auth.json`; OpenCode Go aliases are written to private `auth.json` files with
mode `0600`.

## CLI

```sh
bb ai-accounts list
bb ai-accounts list --json
bb ai-accounts login <account-id>
bb ai-accounts remove <account-id>
```

## Develop

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
bb plugin build
bb plugin install .
```
