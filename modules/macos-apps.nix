{ config, ... }:
{
  config.flake.modules.homeManager.macosApps =
    { pkgs, lib, ... }:
    let
      backgroundMusicModule = import ../macos/background-music.nix { inherit pkgs lib; };

      karabinerConfig = builtins.toJSON {
        global = {
          check_for_updates_on_startup = true;
          show_in_menu_bar = true;
        };

        profiles = [
          {
            name = "Default profile";
            selected = true;
            complex_modifications = {
              rules = [
                {
                  description = "Disable Command+Q";
                  manipulators = [
                    {
                      type = "basic";
                      from = {
                        # qwerty for cmd+q in azerty keyboards
                        key_code = "a";
                        modifiers = {
                          mandatory = [ "left_command" ];
                          optional = [ "any" ];
                        };
                      };
                      to = [
                        {
                          key_code = "vk_none";
                        }
                      ];
                    }
                    {
                      type = "basic";
                      from = {
                        # qwerty for cmd+q in azerty keyboards
                        key_code = "a";
                        modifiers = {
                          mandatory = [ "right_command" ];
                          optional = [ "any" ];
                        };
                      };
                      to = [
                        {
                          key_code = "vk_none";
                        }
                      ];
                    }
                  ];
                }
              ];
            };
            fn_function_keys = [ ];
            simple_modifications = [ ];
            virtual_hid_keyboard = {
              keyboard_type_v2 = "ansi";
            };
          }
        ];
      };
    in
    {
      imports = [ backgroundMusicModule ];

      home.packages = [
        pkgs.spotify
        pkgs.slack
        pkgs."whatsapp-for-mac"
        pkgs.shottr
        pkgs.raycast
        pkgs.caffeine
        pkgs.monitorcontrol
        pkgs."karabiner-elements"
        pkgs.discord
      ];

      home.file.".config/karabiner/karabiner.json".text = karabinerConfig;
    };
}
