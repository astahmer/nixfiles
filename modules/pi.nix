{ inputs, ... }:
{
  config.flake.modules.homeManager.pi =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      system = pkgs.stdenv.hostPlatform.system;

      piPackages = pkgs.buildNpmPackage {
        pname = "pi-packages";
        version = "0.84.2";
        src = ../assets/pi/npm;
        npmDepsHash = "sha256-shMvU+ZMvoz1WQRttZFV9O6Zsgxf9rF+G/PsmR8nKW4=";
        dontNpmBuild = true;
        # node-pty ships platform prebuilds inside the tarball; no install
        # scripts are needed and skipping them keeps the build hermetic.
        npmFlags = [
          "--ignore-scripts"
          "--legacy-peer-deps"
        ];
        installPhase = ''
          mkdir -p $out
          cp -R node_modules $out/node_modules
        '';
      };

      piSettings = {
        theme = "dark";
        defaultProvider = "opencode-go";
        defaultModel = "ox-alpha-free";
        defaultThinkingLevel = "high";
        packages = [
          "npm:@plannotator/pi-extension@0.27.6"
          "npm:pi-autoresearch@1.6.2"
          "npm:pi-local-token-costs@1.3.0"
          "npm:pi-memory@0.4.2"
          "npm:pi-simplify@0.2.3"
          "npm:pi-subagents@0.53.0"
        ];
        tuiMode = "fullscreen";
        hideThinkingBlock = true;
      };
      piSettingsJson = builtins.toJSON piSettings;

      extensionNames = builtins.attrNames (builtins.readDir ../assets/pi/extensions);

      extensionFiles = builtins.listToAttrs (
        map (name: {
          name = ".pi/agent/extensions/${name}";
          value.source = ../assets/pi/extensions + "/${name}";
        }) extensionNames
      );
    in
    {
      home.packages = [ inputs.llm-agents.packages.${system}.pi ];

      home.file = {
        ".pi/agent/npm/package.json".source = ../assets/pi/npm/package.json;
        ".pi/agent/npm/package-lock.json".source = ../assets/pi/npm/package-lock.json;
        ".pi/agent/npm/node_modules".source = "${piPackages}/node_modules";
        ".pi/agent/skills/emisoup-pen-export".source = ../assets/pi/skills/emisoup-pen-export;
      }
      // extensionFiles;

      # pi mutates settings.json at runtime (lastChangelogVersion, model picks),
      # so deploy it as a write-if-changed regular file instead of a store symlink.
      home.activation.piSettings = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        settings_file="${config.home.homeDirectory}/.pi/agent/settings.json"
        candidate_settings="$settings_file.next.$$"

        export PATH="${pkgs.coreutils}/bin:${pkgs.diffutils}/bin"
        ${pkgs.coreutils}/bin/mkdir -p "${config.home.homeDirectory}/.pi/agent"

        ${pkgs.coreutils}/bin/cat > "$candidate_settings" <<'PI_SETTINGS_EOF'
${piSettingsJson}
PI_SETTINGS_EOF

        if [ ! -f "$settings_file" ] || ! ${pkgs.diffutils}/bin/cmp -s "$candidate_settings" "$settings_file"; then
          ${pkgs.coreutils}/bin/mv "$candidate_settings" "$settings_file"
          ${pkgs.coreutils}/bin/chmod 600 "$settings_file"
          echo "pi: initialized or updated $settings_file" >&2
        else
          ${pkgs.coreutils}/bin/rm -f "$candidate_settings"
        fi
      '';
    };
}
