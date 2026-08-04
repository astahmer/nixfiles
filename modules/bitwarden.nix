{ ... }:
{
  config.flake.modules.homeManager.bitwarden =
    {
      config,
      pkgs,
      ...
    }:
    let
      secret = pkgs.writeShellApplication {
        name = "secret";
        runtimeInputs = [
          pkgs.bun
          pkgs.bitwarden-cli
          pkgs.coreutils
        ];
        text = ''
          exec ${pkgs.bun}/bin/bun ${../assets/bitwarden/secret.ts} "$@"
        '';
      };
    in
    {
      home.packages = [
        pkgs.bitwarden-cli
        pkgs.bitwarden-desktop
        pkgs.rbw
        secret
      ];

      home.file.".config/secret/defaults.json".source = ../assets/bitwarden/defaults.json;
      home.sessionVariables.SSH_AUTH_SOCK = "${config.home.homeDirectory}/.bitwarden-ssh-agent.sock";
    };
}
