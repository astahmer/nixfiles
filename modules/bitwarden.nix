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
          if [ -z "''${BW_SESSION:-}" ] && [ -r "''${SECRET_SESSION_FILE:-$HOME/.config/secret/session}" ]; then
            export BW_SESSION="$(cat "''${SECRET_SESSION_FILE:-$HOME/.config/secret/session}")"
          fi
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

      home.sessionVariables.SSH_AUTH_SOCK = "${config.home.homeDirectory}/.bitwarden-ssh-agent.sock";
    };
}
