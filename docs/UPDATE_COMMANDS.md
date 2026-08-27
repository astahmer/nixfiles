# Pinned package update reference

Routine updates run through the Bun app exposed as `.#update-pins`:

```bash
nix run .#update-pins -- --list
nix run .#update-pins -- --dry-run
nix run .#update-pins -- --only codex,iris,ryu
nix run .#update-pins -- --validate fast
```

The runner reads `scripts/update-pins.json`, skips entries marked manual, and
filters system-specific entries using the host system reported by Nix.

## Routine `nix-update` packages

These packages use release archives and the `finalAttrs` pattern:

| Package | Upstream | Update command |
| --- | --- | --- |
| `codex` | OpenAI Codex release archive | `nix run nixpkgs#nix-update -- --flake codex --use-github-releases --github-releases-limit 100 --version-regex 'rust-v(.*)'` |
| `iris` | IRIS release archive | `nix run nixpkgs#nix-update -- --flake iris` |
| `lightjj` | lightjj release binary | `nix run nixpkgs#nix-update -- --flake lightjj` |
| `ryu` | jj-ryu release archive | `nix run nixpkgs#nix-update -- --flake ryu --version=unstable` |
| `zed` | Zed editor prebuilt release bundle | `nix run nixpkgs#nix-update -- --flake zed --use-github-releases --github-releases-limit 100 --version-regex '^v([0-9]+\.[0-9]+\.[0-9]+)$'` |

The commands update the current platform's source selection. Review and
refresh the other platform hashes before applying a cross-platform change.

## Manual package updates

`agy`, `hunk`, `opencodex`, `plannotator`, `ghui`, `modlens`, and `modsearch` remain in the registry as
disabled manual entries because their release version is coupled to an npm
binary, Bun lockfile, recursive dependency hash, bundled skill, or several
platform hashes. Update those values together, then run the package build and
`--validate fast`. ModLens updates must verify both npm tarballs, the published
CLI entry point, and the bundled `skills/modlens` references. agy updates must
refresh the Antigravity release-manifest URL plus both platform hashes; its
built-in self-updater cannot write into the Nix store, so keep the package
version current. ModSearch updates must refresh the npm tarball hash, regenerate
`assets/modsearch/package-lock.json` from the pinned tarball, rebuild for the new
recursive output hash, and refresh the pinned upstream skill commit plus its
archive hash. Provider sign-in remains a runtime concern.

## Flake inputs

The registry includes `nixpkgs`, `flake-parts`, `import-tree`, `home-manager`,
`nix-index-database`, `nub`, and `llm-agents`. Update one input with its
configured command, or update the whole lock file with `nix flake update`.

Keep `llm-agents` on its own pinned nixpkgs revision. Its packages are built
against that revision and are eligible for Numtide's binary cache; forcing it
to follow this flake's nixpkgs turns those downloads back into local builds.
OpenCode is consumed from that package set, so update it by updating the
`llm-agents` input rather than adding a second source-build recipe here.

## Verification

```bash
nix flake check --no-build --all-systems
nix build .#codex .#iris .#modlens .#modsearch .#ryu --no-link
```
