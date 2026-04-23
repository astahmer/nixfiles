{ config, ... }:
{
  config.flake.modules.homeManager.shell =
    { config, lib, pkgs, ... }:
    let
      jjPackage =
        if config.programs.jujutsu.package != null then config.programs.jujutsu.package else pkgs.jujutsu;
    in
    {
      programs.bash.enable = true;
      programs.zsh.enable = true;
      programs.zsh.dotDir = "${config.xdg.configHome}/zsh";

      programs.starship = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
      };

      programs.starship.settings = {
        character.vicmd_symbol = "";

        aws.disabled = true;
        username.disabled = true;

        custom.jj = {
          format = "$output ";
          shell = [ "jj-starship" ];
          when = "jj-starship detect";
        };

        git_branch.disabled = true;
        git_status.disabled = true;
      };

      programs.mcfly = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
      };

      programs.direnv = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
        nix-direnv.enable = true;
      };

      programs.bash.initExtra = lib.mkAfter ''
        eval "$(${lib.getExe pkgs.fnm} env --use-on-cd --shell bash)"
        eval "$(${lib.getExe jjPackage} util completion bash)"
      '';

      programs.zsh.initContent = lib.mkAfter ''
        eval "$(${lib.getExe pkgs.fnm} env --use-on-cd --shell zsh)"
        eval "$(${lib.getExe jjPackage} util completion zsh)"
      '';

      home.shellAliases = {
        nixapply = "nix run nixpkgs#home-manager -- switch -b backup --flake .#macbook";
        nixlint = "nix run github:nix-community/nixpkgs-lint -- .";
        zshconfig = "code ~/.zshrc";
        jjconfig = "code $(jj config path --user)";
        opencodeconfig = "code ~/.config/opencode/opencode.json";
        npmrc = "code ~/.npmrc";
        gitconfig = "code ~/.gitconfig";
        gitignore = "code ~/.gitignore";
        sauce = "source ~/.zshrc";
        ppnm = "pnpm";
        pnpmi = "pnpm i";
        copilot = "gh copilot suggest -t shell";
        nts = "node --no-warnings=ExperimentalWarning --experimental-strip-types --experimental-transform-types --env-file-if-exists=.env";
      };
    };
}
