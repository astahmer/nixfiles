{
  inputs,
  ...
}:
{
  config.flake.modules.homeManager.bitwarden =
    {
      config,
      pkgs,
      lib,
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
      sshSecretConfig = ../.secret.json;
      sshPrivateKey = "${config.home.homeDirectory}/.ssh/id_ed25519";
      sshPublicKey = "${config.home.homeDirectory}/.ssh/id_ed25519.pub";
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

      # Keep the connection policy declarative while leaving private key
      # material in Bitwarden. OrbStack's include stays first, as its own
      # comment requires; the identity file is refreshed only when the vault
      # item can be read during activation.
      home.file.".ssh/config".text = ''
        Include ~/.orbstack/ssh/config

        Host *
          IdentityFile ~/.ssh/id_ed25519
          AddKeysToAgent yes
          ${lib.optionalString pkgs.stdenv.isDarwin "UseKeychain yes"}
      '';

      home.activation.sshPrivateKey = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        sshDir="$HOME/.ssh"
        privateTmp="$sshDir/.id_ed25519.secret.$$"
        publicTmp="$sshDir/.id_ed25519.pub.secret.$$"
        mkdir -p "$sshDir"
        chmod 700 "$sshDir"
        trap 'rm -f "$privateTmp" "$publicTmp"' EXIT

        if [ "''${DRY_RUN:-0}" = 1 ]; then
          echo "secret: dry-run; skipping Bitwarden SSH key materialization" >&2
        elif ${pkgs.coreutils}/bin/timeout 6s ${secret}/bin/secret get --config "${sshSecretConfig}" ssh-private-key > "$privateTmp" 2>/dev/null \
          && [ -s "$privateTmp" ] \
          && ${pkgs.openssh}/bin/ssh-keygen -y -f "$privateTmp" > "$publicTmp" 2>/dev/null; then
          chmod 600 "$privateTmp"
          chmod 644 "$publicTmp"
          mv -f "$privateTmp" "${sshPrivateKey}"
          mv -f "$publicTmp" "${sshPublicKey}"
          echo "secret: refreshed $HOME/.ssh/id_ed25519 from Bitwarden" >&2
        else
          rm -f "$privateTmp" "$publicTmp"
          echo "secret: SSH key item unavailable or invalid; keeping the existing $HOME/.ssh/id_ed25519" >&2
        fi
      '';
    };
}
