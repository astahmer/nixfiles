{ ... }:
{
  config.flake.modules.homeManager.zed =
    { ... }:
    {
      xdg.configFile."zed/settings.json".source = ../assets/zed/settings.jsonc;
      xdg.configFile."zed/keymap.json".source = ../assets/zed/keymap.json;
      xdg.configFile."zed/snippets/snippets.json".source = ../assets/zed/snippets/snippets.json;
      xdg.configFile."zed/snippets/typescript.json".source = ../assets/zed/snippets/typescript.json;
    };
}
