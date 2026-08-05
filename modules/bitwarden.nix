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
          if [ -z "''${BW_SESSION:-}" ]; then
            stored=""
            if [ "$(uname -s)" = "Darwin" ]; then
              stored="$(security find-generic-password -a bitwarden-session -s secret-cli -w 2>/dev/null || true)"
            elif [ -r "''${SECRET_SESSION_FILE:-$HOME/.config/secret/session}" ]; then
              stored="$(cat "''${SECRET_SESSION_FILE:-$HOME/.config/secret/session}")"
            fi
            if [ -n "$stored" ]; then
              export BW_SESSION="$stored"
            fi
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
