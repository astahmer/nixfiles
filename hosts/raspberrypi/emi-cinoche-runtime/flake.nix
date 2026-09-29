{
  description = "Pinned Node.js and pnpm runtime for the Raspberry Pi Emi Cinoche runner";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      system = "aarch64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      nodejs = pkgs.stdenvNoCC.mkDerivation {
        pname = "nodejs";
        version = "24.21.0";

        src = pkgs.fetchurl {
          url = "https://nodejs.org/download/release/v24.21.0/node-v24.21.0-linux-arm64.tar.xz";
          hash = "sha256-atEyXtvbVknDebdaI3FHpmbJXU+a6NNA/vLRV10omtI=";
        };

        sourceRoot = "node-v24.21.0-linux-arm64";
        nativeBuildInputs = [
          pkgs.gnutar
          pkgs.xz
        ];
        dontBuild = true;
        dontFixup = true;

        installPhase = ''
          mkdir -p "$out"
          cp -a ./. "$out/"
        '';
      };
      cloudflared = pkgs.stdenvNoCC.mkDerivation {
        pname = "cloudflared";
        version = "2026.9.3";

        src = pkgs.fetchurl {
          url = "https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-linux-arm64";
          hash = "sha256-qustfQ2jYUY0x+A6sTSHoVIsLnkWXtKSnP4j1elbMm0=";
        };

        dontUnpack = true;
        dontFixup = true;

        installPhase = ''
          install -D -m 0555 "$src" "$out/bin/cloudflared"
        '';
      };
      systemdUnits = pkgs.symlinkJoin {
        name = "emi-cinoche-pi-runner-systemd-units";
        paths = [
          (pkgs.writeTextDir "share/emi-cinoche/systemd/emi-cinoche-geckodriver.service" ''
            [Unit]
            Description=Emi Cinoche private Firefox WebDriver
            After=network.target

            [Service]
            Type=simple
            User=raspberrypi
            Group=raspberrypi
            Environment=HOME=/var/lib/emi-cinoche-geckodriver
            Environment=PATH=/home/raspberrypi/.local/state/nix/profiles/emi-cinoche-runtime/bin:/usr/local/bin:/usr/bin:/bin
            StateDirectory=emi-cinoche-geckodriver
            StateDirectoryMode=0700
            UMask=0077
            ExecStartPre=/usr/bin/install -d -m 0700 /var/lib/emi-cinoche-geckodriver/profiles
            ExecStart=/home/raspberrypi/.local/state/nix/profiles/emi-cinoche-runtime/bin/geckodriver --host 127.0.0.1 --port 4444 --profile-root /var/lib/emi-cinoche-geckodriver/profiles --log info
            Restart=on-failure
            RestartSec=5s
            NoNewPrivileges=true
            PrivateTmp=true
            ProtectSystem=strict
            ProtectHome=read-only
            ProtectKernelTunables=true
            ProtectKernelModules=true
            ProtectControlGroups=true
            RestrictSUIDSGID=true
            LockPersonality=true
            RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

            [Install]
            WantedBy=multi-user.target
          '')
          (pkgs.writeTextDir "share/emi-cinoche/systemd/emi-cinoche-cloudflared.service" ''
            [Unit]
            Description=Emi Cinoche private Cloudflare Workers VPC tunnel
            Wants=network-online.target
            After=network-online.target

            [Service]
            Type=simple
            User=raspberrypi
            Group=raspberrypi
            Environment=HOME=/var/lib/emi-cinoche-cloudflared
            StateDirectory=emi-cinoche-cloudflared
            StateDirectoryMode=0700
            UMask=0077
            LoadCredential=tunnel-token:/var/lib/emi-cinoche-cloudflared/tunnel-token
            ExecStart=/home/raspberrypi/.local/state/nix/profiles/emi-cinoche-runtime/bin/cloudflared tunnel --no-autoupdate --protocol quic run --token-file %d/tunnel-token
            Restart=always
            RestartSec=5s
            NoNewPrivileges=true
            PrivateTmp=true
            ProtectSystem=strict
            ProtectHome=read-only
            ProtectKernelTunables=true
            ProtectKernelModules=true
            ProtectControlGroups=true
            RestrictSUIDSGID=true
            LockPersonality=true
            RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
            CapabilityBoundingSet=
            AmbientCapabilities=

            [Install]
            WantedBy=multi-user.target
          '')
        ];
      };
    in
    {
      packages.${system}.default = pkgs.buildEnv {
        name = "emi-cinoche-pi-runtime";
        paths = [
          nodejs
          pkgs.geckodriver
          cloudflared
          systemdUnits
        ];
      };
    };
}
