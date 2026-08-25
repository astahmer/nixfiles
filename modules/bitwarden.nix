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
      # Global-scope secret aliases are git-synced through the nixfiles clone.
      # The symlink targets the clone (via the ~/.config/nixfiles stable
      # pointer), NOT the read-only store, so `secret set --global` keeps
      # working — edits land in the working copy and jj snapshots them.
      globalSecretConfig = "$HOME/.config/nixfiles/assets/secret/global.json";
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

      # Connection policy (hosts, aliases) lives in the ssh module; this
      # module only materializes the private key at activation time.

      home.activation.secretGlobalConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        target="$HOME/.config/secret/config.json"
        mkdir -p "$HOME/.config/secret"
        if [ -f "$target" ] && [ ! -L "$target" ]; then
          backup="$target.migrated.$(${pkgs.coreutils}/bin/date +%Y%m%d%H%M%S)"
          mv "$target" "$backup"
          echo "secret: machine-local global config moved to $backup" >&2
        fi
        ln -sfn "${globalSecretConfig}" "$target"
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
        elif ${pkgs.coreutils}/bin/timeout 6s ${secret}/bin/secret get --config "${sshSecretConfig}" ssh-private-key-work > "$privateTmp" 2>/dev/null \
          && [ -s "$privateTmp" ] \
          && ${pkgs.openssh}/bin/ssh-keygen -y -f "$privateTmp" > "$publicTmp" 2>/dev/null; then
          chmod 600 "$privateTmp"
          chmod 644 "$publicTmp"
          mv -f "$privateTmp" "${sshPrivateKey}"
          mv -f "$publicTmp" "${sshPublicKey}"
          echo "secret: refreshed $HOME/.ssh/id_ed25519 from Bitwarden" >&2

          # Keep authorized_keys in sync with the shared vault key so peer
          # machines using the same profile can SSH in without a password.
          # Idempotent append: pre-existing entries are preserved.
          touch "$sshDir/authorized_keys"
          chmod 600 "$sshDir/authorized_keys"
          if ! ${pkgs.coreutils}/bin/grep -qxF "$(cat ${sshPublicKey})" "$sshDir/authorized_keys"; then
            ${pkgs.coreutils}/bin/cat "${sshPublicKey}" >> "$sshDir/authorized_keys"
            echo "secret: added id_ed25519 to authorized_keys" >&2
          fi
        else
          rm -f "$privateTmp" "$publicTmp"
          echo "secret: SSH key item unavailable or invalid; keeping the existing $HOME/.ssh/id_ed25519" >&2
        fi
      '';
    };
}
