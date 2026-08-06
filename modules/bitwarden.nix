{
  inputs,
  ...
}:
{
  config.flake.modules.homeManager.bitwarden =
    {
      config,
      pkgs,
      ...
    }:
    let
      secretBin = "${inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secret}/bin/secret";
      secret = pkgs.writeShellApplication {
        name = "secret";
        runtimeInputs = [
          pkgs.bitwarden-cli
          pkgs.coreutils
        ];
        text = ''
          # Unlock must never inherit a (possibly stale) session: it would
          # corrupt bw's protected auto-unlock key. The CLI also strips it.
          if [ -z "''${BW_SESSION:-}" ] && [ "''${1:-}" != "unlock" ]; then
            stored=""
            if [ "$(uname -s)" = "Darwin" ]; then
              stored="$(security find-generic-password -a bitwarden-session -s secret-cli -w 2>/dev/null || true)"
            fi
            if [ -z "$stored" ] && [ -r "''${SECRET_SESSION_FILE:-$HOME/.config/secret/session}" ]; then
              stored="$(cat "''${SECRET_SESSION_FILE:-$HOME/.config/secret/session}")"
            fi
            if [ -n "$stored" ]; then
              export BW_SESSION="$stored"
            fi
          fi
          exec ${secretBin} "$@"
        '';
      };
    in
    {
      home.file.".config/secret/secret-completion.zsh".source = ../assets/bitwarden/secret-completion.zsh;
      home.file.".config/secret/secret-completion.bash".source =
        ../assets/bitwarden/secret-completion.bash;
      home.file.".config/secret/secret-shell.zsh".source = ../assets/bitwarden/secret-shell.zsh;

      home.packages = [
        pkgs.bitwarden-cli
        pkgs.bitwarden-desktop
        pkgs.rbw
        secret
      ];

      home.sessionVariables.SSH_AUTH_SOCK = "${config.home.homeDirectory}/.bitwarden-ssh-agent.sock";
    };
}
