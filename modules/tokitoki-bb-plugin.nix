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
        run_step() {
          step="$1"
          limit="$2"
          shift 2
          started="$SECONDS"
          printf '[nixfiles:installTokitokiBbPlugin] %s started\n' "$step" >&2
          if ${pkgs.coreutils}/bin/timeout --kill-after=5s "$limit" "$@"; then
            elapsed=$((SECONDS - started))
            printf '[nixfiles:installTokitokiBbPlugin] %s completed in %ss\n' "$step" "$elapsed" >&2
          else
            status="$?"
            elapsed=$((SECONDS - started))
            printf '[nixfiles:installTokitokiBbPlugin] %s failed after %ss (status %s)\n' "$step" "$elapsed" "$status" >&2
            return "$status"
          fi
        }
        run_step "source sync" 30s ${pkgs.rsync}/bin/rsync -a --delete \
          --exclude node_modules --exclude dist --exclude .nix-dependency-hash \
          --chmod=Du+wx,Fu+rwX \
          "${pluginSource}/" "${pluginDirectory}/"
        cd "${pluginDirectory}"
        dependency_hash="$(
          ${pkgs.coreutils}/bin/sha256sum package.json pnpm-lock.yaml \
            | ${pkgs.coreutils}/bin/sha256sum \
            | ${pkgs.coreutils}/bin/cut -d ' ' -f1
        )"
        dependency_stamp="${pluginDirectory}/.nix-dependency-hash"
        current_dependency_hash="$(${pkgs.coreutils}/bin/cat "$dependency_stamp" 2>/dev/null || true)"
        if [ ! -d "${pluginDirectory}/node_modules" ] || [ "$current_dependency_hash" != "$dependency_hash" ]; then
          run_step "dependency install" 90s ${pkgs.pnpm}/bin/pnpm install --frozen-lockfile --prefer-offline --silent
          stamp_tmp="$dependency_stamp.next.$$"
          printf '%s\n' "$dependency_hash" > "$stamp_tmp"
          ${pkgs.coreutils}/bin/mv -f "$stamp_tmp" "$dependency_stamp"
        else
          printf '[nixfiles:installTokitokiBbPlugin] dependencies unchanged; install skipped\n' >&2
        fi
        run_step "plugin build" 30s ${pkgs.coreutils}/bin/env "BB_CLI=${bbCli}" "${bbCli}" plugin build
        run_step "plugin install" 45s ${pkgs.coreutils}/bin/env "BB_CLI=${bbCli}" "${bbCli}" plugin install . --yes
        run_step "plugin enable" 20s ${pkgs.coreutils}/bin/env "BB_CLI=${bbCli}" "${bbCli}" plugin enable tokitoki-usage
      '';
    };
}
