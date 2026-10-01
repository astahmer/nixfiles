{ inputs, ... }:
{
  config.flake.modules.homeManager.tokitokiBbPlugin =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      system = pkgs.stdenv.hostPlatform.system;
      pluginSource = ../bb-plugin-tokitoki;
      pluginDirectory = "${config.home.homeDirectory}/.config/bb-plugins/tokitoki-usage";
      tokitokiBin = "${inputs.self.packages.${system}.tokitoki}/bin/tokitoki";
    in
    {
      home.activation.installTokitokiBbPlugin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        export PATH="${pkgs.nodejs_24}/bin:${pkgs.pnpm}/bin:${pkgs.rsync}/bin:$PATH"
        mkdir -p "${pluginDirectory}"
        ${pkgs.rsync}/bin/rsync -a --delete --exclude node_modules --exclude dist "${pluginSource}/" "${pluginDirectory}/"
        ${pkgs.coreutils}/bin/chmod -R u+w "${pluginDirectory}"
        cd "${pluginDirectory}"
        ${pkgs.pnpm}/bin/pnpm install --frozen-lockfile --silent
        bb plugin build
        bb plugin install . --yes
        bb plugin config tokitoki-usage set binaryPath "${tokitokiBin}"
        bb plugin enable tokitoki-usage
      '';
    };
}
