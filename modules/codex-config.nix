{ ... }:
{
  config.flake.modules.homeManager.codexConfig =
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
    in
    {
      home.activation.codexConfig = lib.hm.dag.entryAfter [ "opencodexConfig" ] ''
        codex_home="${codexHome}"
        config_file="${configFile}"
        config_template="${configTemplate}"
        candidate_config="$config_file.next.$$"
        current_sorted="$config_file.current.sorted"
        candidate_sorted="$candidate_config.sorted"

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

        # OpenCodex restores the native file when it stops. Keep the selected
        # native model explicit so a service restart cannot fall back to the
        # client's implicit default or a stale routed model.
        if ${pkgs.gnugrep}/bin/grep -qE '^model[[:space:]]*=' "$config_file"; then
          ${pkgs.gnused}/bin/sed -i -E 's|^model[[:space:]]*=.*$|model = "codex-perso/gpt-5.6-luna"|' "$config_file"
        else
          ${pkgs.gnused}/bin/sed -i '1i model = "codex-perso/gpt-5.6-luna"' "$config_file"
        fi

        ${pkgs.coreutils}/bin/rm -f "$candidate_config" "$current_sorted" "$candidate_sorted"
      '';
    };
}
