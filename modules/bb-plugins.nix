{ ... }:
{
  config.flake.modules.homeManager.bbPlugins =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      pluginRoot = "${config.home.homeDirectory}/dev/bb-plugins";
      customPluginIds = [
        "auto-handoff-parent"
        "diff-viewed"
        "jujutsu"
        "mcp-manager"
        "memory-watch"
        "preserve-child-threads"
        "secret-catalog"
        "settings-search"
        "sidebar-commands"
        "sidebar-resize"
      ];
      thirdPartyPlugins = [
        {
          id = "action-topbar";
          source = "git:https://github.com/MateoCerquetella/bb-plugins.git@semver:action-topbar/:^0.1.0";
          enabled = true;
        }
        {
          id = "agent-graph";
          source = "git:https://github.com/nathancolgate/bb-plugin-agent-graph.git@semver:^0.1.0";
          enabled = false;
        }
        {
          id = "agent-tools";
          source = "git:https://github.com/VKirill/bb-plugin-agent-tools.git@semver:^0.2.0";
          enabled = false;
        }
        {
          id = "bb-sidebar";
          source = "git:https://github.com/yusuf8834/bb-sidebar.git@semver:^0.2.0";
          enabled = true;
        }
        {
          id = "chat-search";
          source = "git:https://github.com/yusuf8834/bb-chat-search.git@semver:^0.1.0";
          enabled = true;
        }
        {
          id = "chatgpt-skin";
          source = "git:https://github.com/euanguo/bb-plugin-chatgpt-skin.git@semver:^0.1.1";
          enabled = true;
        }
        {
          id = "command-code";
          source = "git:https://github.com/aqidd/bb-plugin-command-code.git@semver:^0.1.1";
          enabled = true;
        }
        {
          id = "fast-split";
          source = "git:https://github.com/dmitriikapustin/bb-plugins-by-kapustin.git@semver:fast-split/:^0.1.0";
          enabled = true;
        }
        {
          id = "files-editor";
          source = "git:https://github.com/abdoutelb/bb-plugin-files-editor.git@semver:^0.1.2";
          enabled = true;
        }
        {
          id = "handoff";
          source = "git:https://github.com/vburojevic/bb-plugin-handoff.git@semver:^0.7.0";
          enabled = true;
        }
        {
          id = "hotspot";
          source = "git:https://github.com/Hazihell/bb-plugin-hotspot.git@semver:^0.1.0";
          enabled = true;
        }
        {
          id = "message-timestamps";
          source = "git:https://github.com/bighitbiker3/bb-plugin-message-timestamps.git@semver:^0.1.0";
          enabled = true;
        }
        {
          id = "prompts";
          source = "git:https://github.com/vburojevic/bb-plugin-prompts.git@semver:^0.2.0";
          enabled = false;
        }
        {
          id = "tabs";
          source = "git:https://github.com/nicolay-i/bb-plugin-tabs.git@semver:^0.1.2";
          enabled = false;
        }
        {
          id = "traces";
          source = "git:https://github.com/patleeman/bb-plugins.git@semver:traces/:^0.1.0";
          enabled = false;
        }
        {
          id = "usage";
          source = "git:https://github.com/MayankBansal12/bb-plugin-usage.git@semver:^0.3.1";
          enabled = true;
        }
      ];
      setupDocument = {
        customPlugins = map (id: {
          inherit id;
          source = "${pluginRoot}/plugins/${id}";
          enabled = id != "auto-handoff-parent";
        }) customPluginIds;
        inherit thirdPartyPlugins;
        generalSettings = {
          managedBranchPrefix = "bb/";
          showDiagnosticEvents = false;
          showKeyboardHints = true;
          steerActiveThreadOnEnter = false;
          telemetryEnabled = true;
        };
        uiSettings = {
          "sidebar.organizationMode" = "project";
          "sidebar.threadGrouping.environment" = "auto";
          "sidebar.chronologicalSort" = "updated";
          "sidebar.sortDirection" = "default";
          "sidebar.footerOrder" = [ ];
          "sidebar.hiddenFooterItems" = [ ];
          "sidebar.navigationProvider" = "__automatic__";
          "sidebar.headerProvider" = "__builtin__";
          "sidebar.threadListProvider" = "__automatic__";
          "sidebar.pluginPanelOrder" = [
            "__bb__/new-thread"
            "__bb__/search-threads"
            "files-editor/files"
            "ai-accounts/accounts"
            "__bb__/extensions"
            "__builtin__/tools"
            "automations/automations"
            "__bb__/skills"
            "mcp-manager/servers"
            "simple-notes/docs"
            "tasks/tasks"
            "usage/usage"
            "secret-catalog/secret-catalog"
            "__bb__/automations"
            "plugin-api-docs/plugin-api"
            "plugin-api-tester/plugin-api-tester"
            "jujutsu/jj-workbench"
            "agent-graph/graph"
            "memory-watch/memory-overview"
            "hotspot/hotspot"
          ];
          "sidebar.visiblePluginPanels" = [
            "files-editor/files"
            "memory-watch/memory-overview"
            "agent-graph/graph"
            "ai-accounts/accounts"
            "hotspot/hotspot"
            "mcp-manager/servers"
            "secret-catalog/secret-catalog"
            "__bb__/new-thread"
            "__bb__/extensions"
            "__bb__/skills"
            "__bb__/automations"
            "plugin-api-docs/plugin-api"
            "plugin-api-tester/plugin-api-tester"
            "tasks/tasks"
            "usage/usage"
            "__bb__/search-threads"
          ];
        };
        shortcuts = [
          {
            command = "sidebar.toggle";
            value = "Mod+B";
          }
          {
            command = "panel.toggle";
            value = "Mod+Shift+B";
          }
          {
            command = "terminal.open";
            value = "Mod+J";
          }
        ];
        pluginSettings = [
          {
            id = "usage";
            values = {
              codexHomes = "";
              piSessionRoots = "";
              primeSessionRoots = "";
            };
          }
          {
            id = "hotspot";
            values = {
              allowKill = true;
              cpuThreshold = 80;
              retentionDays = 7;
              sampleIntervalSeconds = 60;
              toast = true;
            };
          }
        ];
      };
      setupConfig = pkgs.writeText "bb-setup.json" (builtins.toJSON setupDocument);
      applyScript = ../assets/bb-plugins/apply.mjs;
    in
    {
      options.programs.bbPlugins.enable =
        lib.mkEnableOption "Nix-managed BB plugins and portable preferences"
        // {
          default = true;
        };

      config = lib.mkIf config.programs.bbPlugins.enable {
        home.activation.installBbPlugins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          export PATH="${pkgs.nodejs_24}/bin:${pkgs.pnpm}/bin:${pkgs.rsync}/bin:$PATH"
          BB_SETUP_CONFIG="${setupConfig}" \
          BB_PLUGIN_ROOT="${config.home.homeDirectory}/.config/bb-plugins" \
            "${pkgs.nodejs_24}/bin/node" "${applyScript}"
        '';
      };
    };
}
