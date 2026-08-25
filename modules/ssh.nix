{ ... }:
{
  config.flake.modules.homeManager.ssh =
    { config, pkgs, lib, ... }:
    {
      # Owns ~/.ssh/config: connection policy and peer aliases only — private
      # key materialization lives in the bitwarden module's activation step.
      #
      # Peer aliases resolve through Tailscale MagicDNS's search domain, so no
      # FQDNs are committed (repo is public). Entries ship to every machine
      # sharing this profile, making them reachable from each other:
      # `herdr --remote <alias>` works in both directions.
      home.file.".ssh/config".text = ''
        Include ~/.orbstack/ssh/config

        Host *
          IdentityFile ~/.ssh/id_ed25519
          AddKeysToAgent yes
          ${lib.optionalString pkgs.stdenv.isDarwin "UseKeychain yes"}

        Host m1-perso
          User ${config.home.username}
          ServerAliveInterval 30
          ServerAliveCountMax 3

        Host m4-pro
          User ${config.home.username}
          ServerAliveInterval 30
          ServerAliveCountMax 3
      '';
    };
}
