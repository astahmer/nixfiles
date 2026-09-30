{ inputs, ... }:
{
  config.flake.modules.homeManager.t3code =
    {
      config,
      pkgs,
      lib,
      ...
    }:
    let
      secret = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.secret;
      secretBin = "${secret}/bin/secret";
      projectSecretConfig = "${config.home.homeDirectory}/.config/nixfiles/.secret.json";
      globalSecretConfig = "${config.home.homeDirectory}/.config/nixfiles/assets/secret/global.json";
      openCodeBin = "${config.home.homeDirectory}/.nix-profile/bin/opencode";
      openCode2Bin = "${config.home.homeDirectory}/.nix-profile/bin/opencode2";
    in
    {
      home.activation.t3codeSeedProviderInstances = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        SECRET_BIN="${secretBin}" \
        PROJECT_SECRET_CONFIG="${projectSecretConfig}" \
        GLOBAL_SECRET_CONFIG="${globalSecretConfig}" \
        OPENCODE_BIN="${openCodeBin}" \
        OPENCODE_V2_BIN="${openCode2Bin}" \
        T3CODE_SETTINGS_SEED_PATH="${../assets/t3code/settings-seed.json}" \
          "${pkgs.nodejs_24}/bin/node" "${../assets/t3code/seed-provider-instances.mjs}"
      '';
    };

  config.flake.modules.nixos.t3code =
    { ... }:
    {
      # T3 Code is a desktop app; on NixOS the seed is only useful when the
      # user data directory is reachable, so this is intentionally a no-op.
      environment.systemPackages = [ ];
    };
}
