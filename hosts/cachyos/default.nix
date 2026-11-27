{
  inputs,
  config,
  ...
}:
let
  hm = config.flake.modules.homeManager;
  username = config.nixfiles.username;
in
{
  # Standalone Home Manager profile for CachyOS/Arch. CachyOS is not a NixOS
  # host, so this reuses the portable Home Manager modules and enables the
  # generic-Linux target; system packages (Steam, Bottles, Sunshine, Docker,
  # Tailscale) stay managed by pacman/flatpak.
  config.flake.homeConfigurations.${config.nixfiles.linuxHomeName} =
    inputs.home-manager.lib.homeManagerConfiguration
      {
        pkgs = import inputs.nixpkgs {
          system = config.nixfiles.linuxSystem;
          config.allowUnfree = true;
        };

        extraSpecialArgs = { inherit inputs; };

        modules = [
          inputs.nix-index-database.homeModules.default
          hm.base
          hm.terminal
          hm.shell
          # hm.bitwarden is macOS-only here: the `secret` Swift CLI relies on
          # macOS posix_spawn/Keychain APIs and does not compile on Linux.
          # Use the Bitwarden desktop/flatpak client on this machine instead.
          hm.ssh
          hm.git
          hm.jujutsu
          hm.ryu
          hm.coding
          hm.zed
          hm.vscode
          hm.agents
          hm.tools
          hm.linuxApps
          hm.launcher
          hm.cliTools
          hm.codexConfig
          hm.iris
          hm.work
          hm.dshRuntime

          (
            { pkgs, ... }:
            let
              # KPackage rejects a plasmoid whose package files are symlinks, so
              # the applet is built as a store directory and copied into place by
              # the activation script below instead of being linked by home.file.
              sleepBlockApplet = pkgs.runCommand "org.astahmer.sleepblock" { } ''
                mkdir -p $out/contents/ui
                cat >$out/metadata.json <<'JSON'
                {
                  "KPackageStructure": "Plasma/Applet",
                  "KPlugin": {
                    "Category": "System Information",
                    "Description": "Toggle manual sleep and screen-lock inhibition",
                    "Icon": "system-suspend-uninhibited",
                    "Id": "org.astahmer.sleepblock",
                    "License": "MIT",
                    "Name": "Sleep Block",
                    "Version": "1.0"
                  },
                  "X-Plasma-API-Minimum-Version": "6.0"
                }
                JSON
                cat >$out/contents/ui/main.qml <<'QML'
                import QtQuick
                import QtQuick.Layouts
                import org.kde.plasma.plasmoid
                import org.kde.kirigami as Kirigami
                import org.kde.plasma.plasma5support as P5Support

                PlasmoidItem {
                    id: root

                    property bool blocked: false

                    readonly property string toggleCommand: "/home/${username}/.local/bin/sleep-block-toggle"
                    readonly property string stateCommand: "/home/${username}/.local/bin/sleep-block-state"

                    switchWidth: Kirigami.Units.gridUnit * 10
                    switchHeight: Kirigami.Units.gridUnit * 8

                    toolTipMainText: "Sleep"
                    toolTipSubText: root.blocked ? "Blocked" : "Allowed"

                    P5Support.DataSource {
                        id: runner
                        engine: "executable"
                        connectedSources: []

                        onNewData: function (source, data) {
                            if (source === root.stateCommand) {
                                const value = String(data.stdout || "").trim()
                                if (value === "on" || value === "off") {
                                    root.blocked = value === "on"
                                }
                            }
                            runner.disconnectSource(source)
                        }
                    }

                    function refresh() {
                        runner.connectSource(root.stateCommand)
                    }

                    function toggle() {
                        runner.connectSource(root.toggleCommand)
                        refreshTimer.restart()
                    }

                    Timer {
                        interval: 5000
                        running: true
                        repeat: true
                        triggeredOnStart: true
                        onTriggered: root.refresh()
                    }

                    Timer {
                        id: refreshTimer
                        interval: 500
                        onTriggered: root.refresh()
                    }

                    compactRepresentation: MouseArea {
                        id: mouseArea

                        implicitWidth: Kirigami.Units.iconSizes.smallMedium
                        implicitHeight: Kirigami.Units.iconSizes.smallMedium
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        acceptedButtons: Qt.LeftButton

                        onClicked: root.toggle()

                        Kirigami.Icon {
                            anchors.fill: parent
                            source: root.blocked ? "system-suspend-inhibited" : "system-suspend-uninhibited"
                            active: mouseArea.containsMouse
                        }
                    }

                    fullRepresentation: Item {
                        Layout.preferredWidth: Kirigami.Units.gridUnit * 12
                        Layout.preferredHeight: Kirigami.Units.gridUnit * 7

                        Column {
                            anchors.centerIn: parent
                            spacing: Kirigami.Units.smallSpacing

                            Kirigami.Icon {
                                anchors.horizontalCenter: parent.horizontalCenter
                                width: Kirigami.Units.iconSizes.medium
                                height: Kirigami.Units.iconSizes.medium
                                source: root.blocked ? "system-suspend-inhibited" : "system-suspend-uninhibited"
                            }

                            Text {
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: root.blocked ? "Sleep blocked" : "Sleep allowed"
                                color: Kirigami.Theme.textColor
                            }
                        }
                    }
                }
                QML
              '';
            in
            {
              home.homeDirectory = "/home/${username}";
              home.username = username;
              targets.genericLinux.enable = true;
              # The Mac runs Claude Code's native installer; here the CLI comes from llm-agents so the
              # DSH runtime's Claude accounts can run `claude auth login`.
              home.packages = [ inputs.llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.claude-code ];
              home.file.".config/autostart/tailscale-systray.desktop".text = ''
                [Desktop Entry]
                Type=Application
                Name=Tailscale
                Exec=/usr/bin/tailscale systray
                Icon=tailscale
                Terminal=false
                X-GNOME-Autostart-enabled=true
              '';

              home.file.".local/bin/vicinae-toggle" = {
                executable = true;
                text = ''
                  #!/bin/sh
                  exec runuser -u ${username} -- env HOME=/home/${username} XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus WAYLAND_DISPLAY=wayland-1 DISPLAY=:0 /home/${username}/.nix-profile/bin/vicinae toggle
                '';
              };

              # Vicinae's portal shortcut registration never binds on
              # Plasma/Wayland, so KWin owns Alt+Space and forwards it to
              # Vicinae's StatusNotifierItem.
              home.file.".local/share/kwin/scripts/vicinae-hotkey/metadata.json" = {
                force = true;
                text = builtins.toJSON {
                  KPackageStructure = "KWin/Script";
                  KPlugin = {
                    Id = "vicinae-hotkey";
                    Name = "Vicinae Hotkey";
                    Description = "Alt+Space toggles Vicinae";
                    Icon = "input-keyboard";
                    Version = "1.0";
                    License = "MIT";
                  };
                  "X-Plasma-API" = "javascript";
                  "X-Plasma-MainScript" = "code/main.js";
                };
              };

              home.file.".local/share/kwin/scripts/vicinae-hotkey/contents/code/main.js" = {
                force = true;
                text = ''
                  registerShortcut("VicinaeToggle", "Vicinae: Toggle", "Alt+Space", function () {
                      callDBus(
                          "org.vicinae.WindowTracker",
                          "/StatusNotifierItem",
                          "org.kde.StatusNotifierItem",
                          "Activate",
                          0,
                          0
                      );
                  });
                '';
              };

              home.activation.vicinaeKwinShortcut = inputs.home-manager.lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                ${pkgs.kdePackages.kconfig}/bin/kwriteconfig6 --file kwinrc --group Plugins --key vicinae-hotkeyEnabled true || true
                ${pkgs.kdePackages.kconfig}/bin/kwriteconfig6 --file kglobalshortcutsrc --group kwin --key VicinaeToggle "Alt+Space,none,Vicinae: Toggle" || true
                /usr/bin/qdbus6 org.kde.KWin /KWin reconfigure || true
              '';

              # Spectacle's Print shortcut opens the GUI. keyd intercepts the
              # single Print key (its chords are unreliable) and captures the
              # whole desktop straight to the clipboard as the logged-in user.
              home.file.".local/bin/screenshot-clipboard" = {
                force = true;
                executable = true;
                text = ''
                  #!/bin/sh
                  exec runuser -u ${username} -- env HOME=/home/${username} \
                    XDG_RUNTIME_DIR=/run/user/1000 \
                    DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
                    WAYLAND_DISPLAY=wayland-1 \
                    XDG_CURRENT_DESKTOP=KDE \
                    /usr/bin/spectacle -f -b -c -n
                '';
              };

              # Caffeine-style switch: inhibits PowerDevil sleep and the KDE
              # screen locker until toggled off. A D-Bus inhibition dies with
              # the client that requested it, so the inhibition is held by a
              # live kde-inhibit process instead of a one-shot qdbus call.
              # State lives in the runtime dir so it disappears with the session.
              home.file.".local/bin/sleep-block-toggle" = {
                force = true;
                executable = true;
                text = ''
                  #!/bin/sh
                  set -eu

                  state="''${XDG_RUNTIME_DIR:-/run/user/1000}/sleep-block"

                  notify() {
                    /usr/bin/notify-send -a "Sleep Block" -i system-suspend "$1"
                  }

                  if [ -f "$state" ]; then
                    # shellcheck disable=SC1090
                    . "$state"
                    kill "$pid" 2>/dev/null || true
                    rm -f "$state"
                    notify "Sleep and screen locking allowed"
                  else
                    nohup /usr/bin/kde-inhibit --power --screenSaver sleep infinity >/dev/null 2>&1 &
                    printf 'pid=%s\n' "$!" >"$state"
                    notify "Sleep and screen locking blocked"
                  fi
                '';
              };

              home.file.".local/bin/sleep-block-state" = {
                force = true;
                executable = true;
                text = ''
                  #!/bin/sh
                  state="''${XDG_RUNTIME_DIR:-/run/user/1000}/sleep-block"
                  if [ -f "$state" ]; then
                    # shellcheck disable=SC1090
                    . "$state"
                    if kill -0 "$pid" 2>/dev/null; then
                      echo on
                      exit 0
                    fi
                  fi
                  echo off
                '';
              };

              # KPackage refuses symlinked package metadata, so the applet is
              # copied out of the store as real files. The copy is skipped when
              # the installed tree already matches, so switches leave the live
              # applet untouched. The widget is only added when the panel has no
              # entry yet.
              home.activation.sleepBlockWidget = inputs.home-manager.lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                plasmoid="$HOME/.local/share/plasma/plasmoids/org.astahmer.sleepblock"
                if ! diff -r ${sleepBlockApplet} "$plasmoid" >/dev/null 2>&1; then
                  rm -rf "$plasmoid"
                  mkdir -p "$(dirname "$plasmoid")"
                  cp -r ${sleepBlockApplet} "$plasmoid"
                  chmod -R u+w "$plasmoid"
                fi
                if ! grep -q "plugin=org.astahmer.sleepblock" "$HOME/.config/plasma-org.kde.plasma.desktop-appletsrc" 2>/dev/null; then
                  /usr/bin/qdbus6 org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript 'panels()[0].addWidget("org.astahmer.sleepblock")' || true
                fi
              '';
            }
          )
        ];
      };
}
