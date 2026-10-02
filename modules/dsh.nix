{ ... }:
{
  config.flake.modules.homeManager.dsh =
    { pkgs, ... }:
    let
      appInfo = pkgs.writeText "dsh-web-app-info.plist" ''
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>CFBundleExecutable</key>
          <string>DeepSeek Harness</string>
          <key>CFBundleIdentifier</key>
          <string>dev.astahmer.dsh.web</string>
          <key>CFBundleName</key>
          <string>DeepSeek Harness</string>
          <key>CFBundlePackageType</key>
          <string>APPL</string>
          <key>CFBundleVersion</key>
          <string>1</string>
        </dict>
        </plist>
      '';
      appLauncher = pkgs.writeShellScript "dsh-web-app-launcher" ''
        exec /bin/zsh -lc '${../assets/dsh/start-dsh}'
      '';
      dshApp = pkgs.runCommand "deepseek-harness-app" { } ''
        mkdir -p "$out/Contents/MacOS"
        cp ${appInfo} "$out/Contents/Info.plist"
        cp ${appLauncher} "$out/Contents/MacOS/DeepSeek Harness"
      '';
      dshStartAlias = pkgs.writeShellScript "dsh-start" ''
        exec "$HOME/.local/bin/dsh-web" "$@"
      '';
    in
    {
      home.file.".dsh/profiles/web/package.json".source = ../assets/dsh/web-profile/package.json;
      home.file.".dsh/profiles/web/cordis.patch.yml".source = ../assets/dsh/web-profile/cordis.patch.yml;
      home.file.".local/bin/dsh-web".source = ../assets/dsh/start-dsh;
      home.file.".local/bin/dsh-start".source = dshStartAlias;
      home.file."Applications/DeepSeek Harness.app".source = dshApp;
      home.shellAliases.dshstart = "dsh-start";
    };
}
