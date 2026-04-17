{
  config,
  ...
}:
{
  config.flake.modules.homeManager.coding =
    { pkgs, ... }:
    {
      home.packages = with pkgs; [
        gh
        jq
        neovim
        nixd
        nixfmt
        ripgrep
        tmux
        vscode
      ];

      programs.direnv = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
        nix-direnv.enable = true;
      };
    };
}
