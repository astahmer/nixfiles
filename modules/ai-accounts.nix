{ inputs, ... }:
{
  config.flake.modules.homeManager.aiAccounts =
    { config, pkgs, lib, ... }:
    let
      inherit (lib) mkIf mkOption types;
      cfg = config.programs.bbAiAccounts;
      homeDirectory = config.home.homeDirectory;
      accounts = map
        (account: {
          inherit (account) id provider displayName;
          path = if account.path == null then "${homeDirectory}/.local/share/bb-ai-accounts/${account.id}" else account.path;
          pathOverrides = account.pathOverrides;
          enabled = account.enabled;
          hiddenModelIds = account.hiddenModelIds;
        })
        cfg.accounts;
      secrets = builtins.filter (entry: entry.alias != null) (map
        (account: {
          accountId = account.id;
          inherit (account) alias scope;
          format = if account.format == null then (if account.provider == "codex" then "codex-auth-json" else "opencode-go-key") else account.format;
        })
        cfg.accounts);
      seedConfig = pkgs.writeText "bb-ai-accounts.json" (builtins.toJSON {
        inherit accounts secrets;
      });
      secretPackage = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secret;
      pluginPath = "${homeDirectory}/.config/nixfiles/bb-plugin-ai-accounts";
      seedScript = "${../assets/ai-accounts/seed.mjs}";
    in
    {
      options.programs.bbAiAccounts = {
        enable = mkOption {
          type = types.bool;
          default = true;
          description = "Whether to install and seed BB Codex and OpenCode Go account profiles.";
        };
        accounts = mkOption {
          type = types.listOf (types.submodule {
            options = {
              id = mkOption {
                type = types.str;
                description = "Stable lowercase profile id used by BB threads.";
              };
              provider = mkOption {
                type = types.enum [ "codex" "opencode-go" ];
                description = "Subscription provider.";
              };
              displayName = mkOption {
                type = types.str;
                description = "Name shown in the BB account page and model picker.";
              };
              path = mkOption {
                type = types.nullOr types.str;
                default = null;
                description = "Provider home path; Codex uses CODEX_HOME, OpenCode uses XDG_DATA_HOME.";
              };
              pathOverrides = mkOption {
                type = types.listOf (types.submodule {
                  options = {
                    projectId = mkOption { type = types.nullOr types.str; default = null; };
                    hostId = mkOption { type = types.nullOr types.str; default = null; };
                    path = mkOption { type = types.str; };
                  };
                });
                default = [ ];
              };
              enabled = mkOption { type = types.bool; default = true; };
              hiddenModelIds = mkOption { type = types.listOf types.str; default = [ ]; };
              alias = mkOption {
                type = types.nullOr types.str;
                default = null;
                description = "Optional secret-cli alias for provider credentials.";
              };
              scope = mkOption {
                type = types.enum [ "project" "global" ];
                default = "project";
                description = "Secret alias scope.";
              };
              format = mkOption {
                type = types.nullOr (types.enum [ "opencode-go-key" "codex-auth-json" ]);
                default = null;
                description = "Credential value format returned by secret-cli.";
              };
            };
          });
          default = [ ];
          description = "Declarative provider accounts. Credentials are resolved from secret-cli at activation.";
        };
      };

      config = mkIf cfg.enable {
        programs.bbAiAccounts.accounts = lib.mkDefault [
          {
            id = "codex";
            provider = "codex";
            displayName = "Codex";
          }
          {
            id = "codex-work";
            provider = "codex";
            displayName = "Codex Work";
          }
          {
            id = "codex-alex2";
            provider = "codex";
            displayName = "Codex Alex2";
          }
          {
            id = "opencode-go-alex";
            provider = "opencode-go";
            displayName = "OpenCode Go (Alex)";
            alias = "opencode-go-alex";
            scope = "project";
          }
          {
            id = "opencode-go-manu";
            provider = "opencode-go";
            displayName = "OpenCode Go (Manu)";
            alias = "opencode-go-manu";
            scope = "global";
          }
          {
            id = "opencode-go-mathias";
            provider = "opencode-go";
            displayName = "OpenCode Go (Mathias)";
            alias = "opencode-go-mathias";
            scope = "global";
          }
        ];
        assertions = [
          {
            assertion = builtins.all
              (account: account.alias == null || account.format != "opencode-go-key" || account.provider == "opencode-go")
              cfg.accounts;
            message = "opencode-go-key credentials require an opencode-go account.";
          }
          {
            assertion = builtins.all
              (account: account.alias == null || account.format != "codex-auth-json" || account.provider == "codex")
              cfg.accounts;
            message = "codex-auth-json credentials require a Codex account.";
          }
        ];

        home.activation.bbAiAccounts = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          if command -v bb >/dev/null 2>&1 && [ -d "${pluginPath}" ]; then
            (
              cd "${pluginPath}"
              lockHash="$(${pkgs.coreutils}/bin/sha256sum package-lock.json | cut -d ' ' -f 1)"
              lockStamp="${homeDirectory}/.local/state/bb-ai-accounts/package-lock-hash"
              mkdir -p "$(dirname "$lockStamp")"
              if [ ! -f "$lockStamp" ] || [ "$(cat "$lockStamp")" != "$lockHash" ]; then
                ${pkgs.nodejs_24}/bin/npm ci --silent
                printf '%s' "$lockHash" > "$lockStamp"
              fi
              bb plugin build
              bb plugin install "${pluginPath}" --yes
            )

            export SECRET_BIN="${secretPackage}/bin/secret"
            export GLOBAL_SECRET_CONFIG="${homeDirectory}/.config/nixfiles/assets/secret/global.json"
            export PROJECT_SECRET_CONFIG="${homeDirectory}/.config/nixfiles/.secret.json"
            export AI_ACCOUNTS_CONFIG="${seedConfig}"
            export BB_BIN="$(command -v bb)"
            ${pkgs.nodejs_24}/bin/node "${seedScript}"
          elif ! command -v bb >/dev/null 2>&1; then
            echo "bb-ai-accounts: bb CLI not found; profile seed skipped." >&2
          else
            echo "bb-ai-accounts: source missing at ${pluginPath}; clone nixfiles there and re-apply." >&2
          fi
        '';
      };
    };
}
