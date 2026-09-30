{ inputs, ... }:
{
  config.flake.modules.homeManager.aiAccounts =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (lib) mkEnableOption mkOption types;
      settings = config.programs.bbAiAccounts;
      pluginSource = ../bb-plugin-ai-accounts;
      secretPackage = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secret;
      accountsDocument = {
        accounts = map (account: {
          inherit (account)
            id
            provider
            displayName
            path
            ;
          enabled = account.enabled;
          pathOverrides = [ ];
          hiddenModelIds = [ ];
        }) settings.accounts;
      };
      secretsDocument = map (account: {
        inherit (account) id provider path;
        alias = account.secretAlias;
        scope = account.secretScope;
      }) (builtins.filter (account: account.secretAlias != null) settings.accounts);
    in
    {
      options.programs.bbAiAccounts = {
        enable = mkEnableOption "Nix-managed BB Codex and OpenCode Go accounts" // {
          default = true;
        };
        accounts = mkOption {
          description = "Declarative AI account profiles and optional secret-cli aliases.";
          type = types.listOf (
            types.submodule (
              { ... }: {
                options = {
                  id = mkOption { type = types.strMatching "^[a-z0-9][a-z0-9-]{0,47}$"; };
                  provider = mkOption {
                    type = types.enum [
                      "codex"
                      "opencode-go"
                    ];
                  };
                  displayName = mkOption { type = types.str; };
                  path = mkOption { type = types.str; };
                  enabled = mkOption {
                    type = types.bool;
                    default = true;
                  };
                  secretAlias = mkOption {
                    type = types.nullOr types.str;
                    default = null;
                  };
                  secretScope = mkOption {
                    type = types.enum [
                      "project"
                      "global"
                    ];
                    default = "project";
                  };
                };
              }
            )
          );
          default = [
            {
              id = "codex";
              provider = "codex";
              displayName = "Codex";
              path = "${config.home.homeDirectory}/.codex";
            }
            {
              id = "codex-work";
              provider = "codex";
              displayName = "Codex Work";
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/codex/work";
            }
            {
              id = "codex-alex2";
              provider = "codex";
              displayName = "Codex Alex2";
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/codex/alex2";
            }
            {
              id = "opencode-go-alex";
              provider = "opencode-go";
              displayName = "OpenCode Go Alex";
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/opencode/alex";
              secretAlias = "opencode-go-alex";
            }
            {
              id = "opencode-go-manu";
              provider = "opencode-go";
              displayName = "OpenCode Go Manu";
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/opencode/manu";
              secretAlias = "opencode-go-manu";
              secretScope = "global";
            }
            {
              id = "opencode-go-mathias";
              provider = "opencode-go";
              displayName = "OpenCode Go Mathias";
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/opencode/mathias";
              secretAlias = "opencode-go-mathias";
              secretScope = "global";
            }
          ];
        };
      };

      config = lib.mkIf settings.enable {
        home.file.".config/bb-plugin-ai-accounts/accounts.json".text = builtins.toJSON accountsDocument;
        home.file.".config/bb-plugin-ai-accounts/secrets.json".text = builtins.toJSON secretsDocument;

        home.activation.installBbAiAccounts = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          export PATH="${pkgs.nodejs_24}/bin:${pkgs.rsync}/bin:${pkgs.coreutils}/bin:$PATH"
          plugin_dir="${config.home.homeDirectory}/.config/bb-plugin-ai-accounts/plugin"
          mkdir -p "$plugin_dir"
          rsync -a --delete --exclude node_modules --exclude dist "${pluginSource}/" "$plugin_dir/"
          cd "$plugin_dir"
          npm ci --no-audit --no-fund --silent
          bb plugin build
          bb plugin install . --yes
          AI_ACCOUNTS_CONFIG="${config.home.homeDirectory}/.config/bb-plugin-ai-accounts/accounts.json" \
          AI_ACCOUNTS_SECRETS="${config.home.homeDirectory}/.config/bb-plugin-ai-accounts/secrets.json" \
          SECRET_BIN="${secretPackage}/bin/secret" \
          PROJECT_SECRET_CONFIG="${config.home.homeDirectory}/.config/nixfiles/.secret.json" \
          GLOBAL_SECRET_CONFIG="${config.home.homeDirectory}/.config/nixfiles/assets/secret/global.json" \
          BB_AI_ACCOUNTS_PLUGIN="${config.home.homeDirectory}/.config/bb-plugin-ai-accounts/plugin" \
            "${pkgs.nodejs_24}/bin/node" "${../assets/ai-accounts/seed.mjs}"
        '';
      };
    };
}
