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
      pluginSource = "${inputs."bb-plugins"}/plugins/ai-accounts";
      secretPackage = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secret;
      providerIconOptions = [
        "Bot"
        "BriefcaseBusiness"
        "Code"
        "FlaskConical"
        "Rocket"
        "Sparkles"
        "Terminal"
        "Layers"
        "Brain"
        "Globe"
        "Command"
        "Gem"
      ];
      accountsDocument = {
        accounts = lib.imap0 (index: account: {
          inherit (account)
            id
            provider
            displayName
            path
            badge
            accentColor
            modelReasoningDefaults
            ;
          providerIcon =
            if account.providerIcon == null then
              builtins.elemAt providerIconOptions (builtins.mod index (builtins.length providerIconOptions))
            else
              account.providerIcon;
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
                  badge = mkOption {
                    type = types.strMatching "^[A-Za-z0-9]{1,4}$";
                    default = "AI";
                  };
                  accentColor = mkOption {
                    type = types.strMatching "^#[0-9A-Fa-f]{6}$";
                    default = "#2563EB";
                  };
                  providerIcon = mkOption {
                    type = types.nullOr (types.enum providerIconOptions);
                    default = null;
                  };
                  modelReasoningDefaults = mkOption {
                    type = types.attrsOf (
                      types.enum [
                        "none"
                        "low"
                        "medium"
                        "high"
                        "xhigh"
                        "ultracode"
                        "max"
                        "ultra"
                      ]
                    );
                    default = { };
                  };
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
              badge = "EM";
              accentColor = "#2563EB";
              providerIcon = "Bot";
              modelReasoningDefaults = {
                "gpt-6-luna" = "max";
                "gpt-6.1-sol" = "low";
              };
              path = "${config.home.homeDirectory}/.codex";
            }
            {
              id = "codex-work";
              provider = "codex";
              displayName = "Codex Work";
              badge = "CW";
              accentColor = "#DC2626";
              providerIcon = "BriefcaseBusiness";
              modelReasoningDefaults = {
                "gpt-6-luna" = "max";
                "gpt-6.1-sol" = "low";
              };
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/codex/work";
            }
            {
              id = "codex-alex2";
              provider = "codex";
              displayName = "Codex Alex2";
              badge = "CA";
              accentColor = "#16A34A";
              providerIcon = "Code";
              modelReasoningDefaults = {
                "gpt-6-luna" = "max";
                "gpt-6.1-sol" = "low";
              };
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/codex/alex2";
            }
            {
              id = "opencode-go-alex";
              provider = "opencode-go";
              displayName = "OpenCode Go Alex";
              badge = "OA";
              accentColor = "#7C3AED";
              providerIcon = "FlaskConical";
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/opencode/alex";
              secretAlias = "opencode-go-alex";
            }
            {
              id = "opencode-go-manu";
              provider = "opencode-go";
              displayName = "OpenCode Go Manu";
              badge = "OM";
              accentColor = "#C026D3";
              providerIcon = "Rocket";
              path = "${config.home.homeDirectory}/.local/share/bb-ai-accounts/opencode/manu";
              secretAlias = "opencode-go-manu";
              secretScope = "global";
            }
            {
              id = "opencode-go-mathias";
              provider = "opencode-go";
              displayName = "OpenCode Go Mathias";
              badge = "OX";
              accentColor = "#EA580C";
              providerIcon = "Sparkles";
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

        home.activation.installBbAiAccounts = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
          bb_cli="''${BB_CLI:-$(command -v bb || true)}"
          if [ -z "$bb_cli" ]; then
            echo "error: BB CLI not found; set BB_CLI or add bb to PATH" >&2
            exit 1
          fi
          export PATH="${pkgs.nodejs_24}/bin:${pkgs.pnpm}/bin:${pkgs.rsync}/bin:${pkgs.coreutils}/bin:$PATH"
          export PATH="$(dirname "$bb_cli"):$PATH"
          plugin_dir="${config.home.homeDirectory}/.config/bb-plugin-ai-accounts/plugin"
          mkdir -p "$plugin_dir"
          rsync -a --delete --exclude node_modules --exclude dist "${pluginSource}/" "$plugin_dir/"
          ${pkgs.coreutils}/bin/chmod -R u+w "$plugin_dir"
          cd "$plugin_dir"
          pnpm install --frozen-lockfile --silent
          "$bb_cli" plugin build
          "$bb_cli" plugin install . --yes
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
