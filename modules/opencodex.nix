{ inputs, ... }:
{
  config.flake.modules.homeManager.opencodex =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      opencodex = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.opencodex;
      secretsEnv = "${config.home.homeDirectory}/.config/opencodex/secrets.env";
    in
    {
      # `ocx` wrapper execs `bun` from PATH (same pattern as ghui).
      home.packages = [
        pkgs.bun
        opencodex
      ];

      home.file.".config/opencodex/secrets.env.example".source = ../assets/opencodex/secrets.env.example;

      home.activation.opencodexSeedSecrets = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        secrets_dir="${config.home.homeDirectory}/.config/opencodex"
        secrets_file="${secretsEnv}"
        example_file="${config.home.homeDirectory}/.config/opencodex/secrets.env.example"
        opencodex_home="${config.home.homeDirectory}/.opencodex"
        config_template="${../assets/opencodex/config.template.json}"

        # Bootstrap ~/.opencodex/config.json only when the user has no config
        # yet. OpenCodex owns the file afterwards (atomic temp+rename writes),
        # so it must not be a Home Manager symlink or a perpetual source of truth.
        if [ ! -f "$opencodex_home/config.json" ]; then
          ${pkgs.coreutils}/bin/mkdir -p "$opencodex_home"
          ${pkgs.coreutils}/bin/cp "$config_template" "$opencodex_home/config.json"
          ${pkgs.coreutils}/bin/chmod 600 "$opencodex_home/config.json"
          echo "opencodex: bootstrapped $opencodex_home/config.json from Nix template" >&2
        fi

        if [ ! -f "$secrets_file" ] && [ -f "$example_file" ]; then
          ${pkgs.coreutils}/bin/mkdir -p "$secrets_dir"
          ${pkgs.coreutils}/bin/cp "$example_file" "$secrets_file"
          ${pkgs.coreutils}/bin/chmod 600 "$secrets_file"
          echo "opencodex: created $secrets_file (fill in API keys)" >&2
        fi
      '';
    };

  config.flake.modules.nixos.opencodex =
    { pkgs, ... }:
    let
      opencodex = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.opencodex;
    in
    {
      environment.systemPackages = [
        pkgs.bun
        opencodex
      ];
    };
}
