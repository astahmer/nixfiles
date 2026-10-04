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
      pluginSource = "${config.home.homeDirectory}/dev/bb-plugins/plugins/tokitoki-usage";
      pluginDirectory = "${config.home.homeDirectory}/.config/bb-plugins/tokitoki-usage";
      # The only `bb` client on this machine ships inside the desktop bundle.
      bbCli = lib.getExe inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.bb;
    in
    {
      home.activation.installTokitokiBbPlugin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        export PATH="${pkgs.nodejs_24}/bin:${pkgs.pnpm}/bin:${pkgs.rsync}/bin:$PATH"
        mkdir -p "${pluginDirectory}"
        ${pkgs.rsync}/bin/rsync -a --delete --exclude node_modules --exclude dist "${pluginSource}/" "${pluginDirectory}/"
        ${pkgs.coreutils}/bin/chmod -R u+w "${pluginDirectory}"
        cd "${pluginDirectory}"
        ${pkgs.pnpm}/bin/pnpm install --frozen-lockfile --silent
        BB_CLI="${bbCli}" "${bbCli}" plugin build
        BB_CLI="${bbCli}" "${bbCli}" plugin install . --yes
        BB_CLI="${bbCli}" "${bbCli}" plugin enable tokitoki-usage
      '';
    };
}
