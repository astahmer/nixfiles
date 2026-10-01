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
      pluginSource = "${inputs."bb-plugins"}/plugins/tokitoki-usage";
      pluginDirectory = "${config.home.homeDirectory}/.config/bb-plugins/tokitoki-usage";
    in
    {
      home.activation.installTokitokiBbPlugin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        bb_cli="''${BB_CLI:-$(command -v bb || true)}"
        if [ -z "$bb_cli" ]; then
          echo "error: BB CLI not found; set BB_CLI or add bb to PATH" >&2
          exit 1
        fi
        export PATH="${pkgs.nodejs_24}/bin:${pkgs.pnpm}/bin:${pkgs.rsync}/bin:$PATH"
        mkdir -p "${pluginDirectory}"
        ${pkgs.rsync}/bin/rsync -a --delete --exclude node_modules --exclude dist "${pluginSource}/" "${pluginDirectory}/"
        ${pkgs.coreutils}/bin/chmod -R u+w "${pluginDirectory}"
        cd "${pluginDirectory}"
        ${pkgs.pnpm}/bin/pnpm install --frozen-lockfile --silent
        "$bb_cli" plugin build
        "$bb_cli" plugin install . --yes
        "$bb_cli" plugin enable tokitoki-usage
      '';
    };
}
