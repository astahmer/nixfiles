{ ... }:
{
  config.flake.modules.homeManager.bitwarden =
    {
      config,
      pkgs,
      ...
    }:
    let
      secretsRefresh = pkgs.writeShellApplication {
        name = "secrets-refresh";
        runtimeInputs = [
          pkgs.bitwarden-cli
          pkgs.coreutils
        ];
        text = builtins.readFile ../assets/bitwarden/secrets-refresh;
      };
    in
    {
      home.packages = [
        pkgs.bitwarden-cli
        pkgs.bitwarden-desktop
        pkgs.rbw
        secretsRefresh
      ];

      home.sessionVariables.SSH_AUTH_SOCK = "${config.home.homeDirectory}/.bitwarden-ssh-agent.sock";
    };
}
