{ inputs, ... }:
{
  config.flake.modules.homeManager.shiftshift =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      shiftshift = inputs.self.packages.${system}.shiftshift;
      configTemplate = ../assets/shiftshift/config.json;
      appDataDir = "${config.home.homeDirectory}/Library/Application Support/dev.shiftshift.tauri";
      shiftCli = pkgs.writeShellScriptBin "shift" ''
        exec "${shiftshift}/bin/shift" "$@"
      '';
    in
    {
      # Keep the GUI bundle in ~/Applications and expose only the CLI in the
      # profile, so app discovery does not see the same bundle twice.
      home.file."Applications/shiftshift.app".source = "${shiftshift}/Applications/shiftshift.app";
      home.packages = [ shiftCli ];

      # The app writes these files itself, so a home.file symlink would make
      # settings writes target the read-only Nix store. Seed each file once
      # from the versioned portable backup instead, then leave it user-owned.
      home.file.".config/shiftshift/config.json".source = configTemplate;
      home.activation.shiftshiftConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        app_data_dir="${appDataDir}"
        backup_file="${configTemplate}"
        mkdir -p "$app_data_dir"

        seed_file() {
          target="$app_data_dir/$1"
          if [ ! -e "$target" ]; then
            ${pkgs.jq}/bin/jq "$2" "$backup_file" > "$target.next.$$"
            ${pkgs.coreutils}/bin/mv "$target.next.$$" "$target"
            ${pkgs.coreutils}/bin/chmod 600 "$target"
            echo "shiftshift: initialized $target" >&2
          fi
        }

        seed_file settings.json '.settings'
        seed_file templates.json '.templates'
        seed_file custom_themes.json '.custom_themes'
      '';
    };
}
