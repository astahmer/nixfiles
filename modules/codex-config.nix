{ inputs, ... }:
{
  config.flake.modules.homeManager.codex-config =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      codexHome = "${config.home.homeDirectory}/.codex";
      configFile = "${codexHome}/config.toml";
      configTemplate = "${../assets/codex/config.template.toml}";
      jq = "${pkgs.jq}/bin/jq";
      cmp = "${pkgs.diffutils}/bin/cmp";
    in
    {
      home.activation.codexConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        codex_home="${codexHome}"
        config_file="${configFile}"
        config_template="${configTemplate}"
        candidate_config="$config_file.next.$$"
        current_sorted="$config_file.current.sorted"
        candidate_sorted="$candidate_config.sorted"

        export PATH="${pkgs.coreutils}/bin:${pkgs.diffutils}/bin:${pkgs.jq}/bin:/usr/bin:/bin"
        ${pkgs.coreutils}/bin/mkdir -p "$codex_home"

        # Use the template only for first-run defaults. Once a config exists,
        # its values win so app edits remain user-owned.
        if [ ! -f "$config_file" ]; then
          ${pkgs.coreutils}/bin/cp "$config_template" "$candidate_config"

          # Replace home directory placeholder in template
          ${pkgs.gnused}/bin/sed -i "s|HOME_DIR|${config.home.homeDirectory}|g" "$candidate_config"

          ${pkgs.coreutils}/bin/cp "$candidate_config" "$config_file"
          ${pkgs.coreutils}/bin/chmod 600 "$config_file"
          echo "codex: initialized $config_file from template" >&2
        fi

        ${pkgs.coreutils}/bin/rm -f "$candidate_config" "$current_sorted" "$candidate_sorted"
      '';
    };
}
