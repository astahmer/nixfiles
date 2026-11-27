{ ... }:
{
  config.flake.modules.homeManager.launcher =
    { config, pkgs, lib, ... }:
    {
      programs.vicinae = {
        enable = true;
        systemd.enable = true;
      };

      # Raycast uses Option+Space; on Linux that is Alt+Space.
      # Keep the portal's app-info lookup happy by placing the desktop file
      # in the standard user data dir, not only in the Nix profile.
      xdg.configFile."vicinae/settings.json".text = builtins.toJSON {
        "$schema" = "https://vicinae.com/schemas/config.json";
        global_shortcuts.toggle = "alt+space";
      };

      home.file.".local/share/applications/vicinae.desktop".text = ''
        [Desktop Entry]
        Type=Application
        Name=Vicinae
        GenericName=Vicinae
        Comment=A focused launcher for your desktop
        Exec=${config.home.homeDirectory}/.nix-profile/bin/vicinae server --replace
        Terminal=false
        Icon=vicinae
        Categories=Utility;Accessibility;
        NoDisplay=false
        StartupWMClass=vicinae
        StartupNotify=false
      '';

      # KRunner owns Alt+Space by default; release it for Vicinae.
      home.activation.vicinaeShortcut = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        ${pkgs.kdePackages.kconfig}/bin/kwriteconfig6 --file kglobalshortcutsrc --group "org.kde.krunner.desktop" --key _launch "none,none,Run Command" || true
        ${pkgs.systemd}/bin/systemctl --user stop plasma-krunner.service || true
        ${pkgs.systemd}/bin/systemctl --user mask plasma-krunner.service || true
        /usr/bin/qdbus6 org.kde.kglobalaccel /component/org_kde_krunner_desktop org.kde.kglobalaccel.Component.cleanUp || true
        ${pkgs.systemd}/bin/systemctl --user restart vicinae.service || true
      '';
    };
}
