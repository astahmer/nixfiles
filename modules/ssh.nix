{ ... }:
{
  config.flake.modules.homeManager.ssh =
    {
      config,
      pkgs,
      lib,
      ...
    }:
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
      ''
      # maocode is private and this Linux machine has no account key, so it
      # reaches the repository with a read-only deploy key: `github.com-maocode`
      # is the same host, offering only that key. GitHub matches a deploy key to
      # its one repository, so it stays useless for anything else. The key file
      # is generated on the machine, never committed.
      + lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
        Host github.com-maocode
          HostName github.com
          User git
          IdentityFile ~/.ssh/maocode_deploy
          IdentitiesOnly yes
      '';

      # GitHub's published host keys (https://api.github.com/meta), so a machine
      # with no known_hosts entry can clone over SSH without a trust-on-first-use
      # prompt. Public data, so the same keys ship to every machine. The ed25519
      # fingerprint must be SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.
      home.file.".ssh/known_hosts".text = ''
        github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
        github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
        github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
      '';
    };
}
