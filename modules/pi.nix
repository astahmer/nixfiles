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
        npmDepsHash = "sha256-dKEsF6Zafo3XapjdxVjxawNRKmaiyE4UcG+y2YjZPFo=";
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
          "npm:@ff-labs/pi-fff@0.9.6"
          "npm:@plannotator/pi-extension@0.27.6"
          "npm:pi-autoresearch@1.6.2"
          "npm:pi-memory@0.4.2"
          "npm:pi-simplify@0.2.3"
          "npm:pi-smart-copy@0.1.0"
          "npm:pi-subagents@0.53.0"
          "npm:pine-of-glass@0.6.2"
          "npm:pi-goosedump@0.12.57"
        ];
        tuiMode = "fullscreen";
        hideThinkingBlock = true;
      };
      piSettingsJson = builtins.toJSON piSettings;

      extensionNames = builtins.attrNames (builtins.readDir ../assets/pi/extensions);

      # Extensions are copied (not symlinked) into ~/.pi/agent/extensions so
      # they stay writable at runtime. The assets tree wins on every apply;
      # promote lasting tweaks back into assets/pi/extensions.
      copyExtensionCmds = lib.concatStringsSep "\n" (
        map (
          name:
          ''
            ${pkgs.coreutils}/bin/rm -rf "$ext_dir/${name}"
            ${pkgs.coreutils}/bin/install -m 644 "${../assets/pi/extensions + "/${name}"}" "$ext_dir/${name}"
          ''
        ) extensionNames
      );
    in
    {
      home.packages = [ inputs.llm-agents.packages.${system}.pi ];

      # pi stays fully mutable at runtime (pi install, model picks,
      # lastChangelogVersion). Nix only seeds ~/.pi/agent/npm and settings.json
      # when the pinned tree changes, detected via a stamp file holding the
      # store path of the built node_modules. Day-to-day pi tweaks survive
      # unrelated nixapply runs; bumping pins reseeds everything.
      home.activation.piSeed = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        agent_dir="${config.home.homeDirectory}/.pi/agent"
        npm_dir="$agent_dir/npm"
        stamp_file="$npm_dir/.nix-stamp"
        wanted="${piPackages}/node_modules"

        export PATH="${pkgs.coreutils}/bin:${pkgs.diffutils}/bin"
        ${pkgs.coreutils}/bin/mkdir -p "$npm_dir"

        current_stamp="$(${pkgs.coreutils}/bin/cat "$stamp_file" 2>/dev/null || true)"
        if [ "$current_stamp" != "$wanted" ]; then
          ${pkgs.coreutils}/bin/rm -rf "$npm_dir/node_modules" "$agent_dir/settings.json" \
            "$npm_dir/package.json" "$npm_dir/package-lock.json"
          ${pkgs.coreutils}/bin/cp -R "$wanted" "$npm_dir/node_modules"
          ${pkgs.coreutils}/bin/chmod -R u+w "$npm_dir/node_modules"
          ${pkgs.coreutils}/bin/install -m 644 "${../assets/pi/npm/package.json}" "$npm_dir/package.json"
          ${pkgs.coreutils}/bin/install -m 644 "${../assets/pi/npm/package-lock.json}" "$npm_dir/package-lock.json"

          ${pkgs.coreutils}/bin/cat > "$agent_dir/settings.json" <<'PI_SETTINGS_EOF'
${piSettingsJson}
PI_SETTINGS_EOF
          ${pkgs.coreutils}/bin/chmod 600 "$agent_dir/settings.json"

          printf '%s' "$wanted" > "$stamp_file"
          echo "pi: seeded pinned packages and settings from $wanted" >&2
        fi
      '';

      home.activation.piExtensions = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        ext_dir="${config.home.homeDirectory}/.pi/agent/extensions"
        ${pkgs.coreutils}/bin/mkdir -p "$ext_dir"

        ${copyExtensionCmds}
      '';
    };
}
