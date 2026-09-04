# macOS Removal Plan

This plan assumes the standalone Home Manager profile is already working:

```bash
nixapply
```

Keep Nix itself installed. Home Manager still depends on it.

## 1. Apply the declarative app profile

Apply once while the old copies are still installed. The profile now manages
these apps as pinned binary packages and exposes them under `~/Applications`.
It keeps these managed GUI bundles out of the Nix profile, so Raycast should
show one result per app instead of a user-facing link plus a `/nix/store`
result:

- nixpkgs binaries: Raycast, Google Chrome, Slack, Spotify, Visual Studio Code,
  Cursor, OrbStack, MonitorControl, Beekeeper Studio, ChatGPT, Linear, and
  Ghostty
- local release wrappers: Discord (signed DMG), Claude, tldraw offline,
  pen.dev/Pencil, Recordly, and T3 Code (Alpha)

The T3 Code package deliberately consumes the upstream arm64 release archive;
it does not build the T3 Code source tree.

```bash
nixapply
```

Check that the new user-level app links exist before removing the old copies:

```bash
find "$HOME/Applications" -maxdepth 1 -type l -name '*.app' -print
```

For T3 Code and the other apps, launch the result whose location is
`~/Applications`. Never launch the `/nix/store/.../Applications` result; that
is the package implementation path and should disappear from the profile after
this switch.

## 2. Remove the apps that are now declarative

These Homebrew cask tokens are now managed by Home Manager and should no
longer be kept by Homebrew. The loop skips tokens that are not installed;
Pen.dev is a direct-release install and may need a separate manual check.

```bash
for cask in \
  alt-tab background-music caffeine cleanshot discord google-chrome \
  monitorcontrol openusage raycast shottr slack spotify whatsapp-for-mac \
  karabiner-elements orbstack visual-studio-code cursor beekeeper-studio \
  chatgpt claude ghostty linear tldraw recordly t3-code; do
  if brew list --cask --versions "$cask" >/dev/null 2>&1; then
    brew uninstall --cask "$cask"
  fi
done
brew cleanup
```

After verifying the user-level links, remove any duplicate manually copied
bundles from `/Applications` (including `Pencil.app` if it was installed from
the pen.dev download page). Do not delete the `~/Applications` links created
by Home Manager.

If Homebrew is no longer needed for anything else, untap the default repositories after the casks are gone:

```bash
brew untap homebrew/homebrew-core
brew untap homebrew/homebrew-cask
```

## 3. Audit the binaries that should come from Nix

These commands should resolve only to Nix-managed paths such as `~/.nix-profile/bin` or `/nix/store`.
If `where` shows `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, or any other global prefix,
remove that duplicate before relying on the Nix profile.

```bash
for bin in bat code codexbar comma cursor deadnix docker ffmpeg fnm fzf gh ghostty htop hyperfine jj jj-starship jjui jq lazydocker ncdu neovim nixd nixfmt orb rg tokei tree tmux uv yt-dlp zed zeditor; do
	where "$bin"
done
```

If Homebrew still owns any of the prompt tools, remove those copies as well:

```bash
brew uninstall jjui jj jj-starship
brew cleanup
```

If `where starship` still shows `/usr/local/bin/starship`, remove that legacy binary separately with `sudo rm /usr/local/bin/starship`.

If Background Music was ever installed outside Nix, remove the old app bundle too:

```bash
sudo rm -rf /Applications/Background\ Music.app
```

Do not install these tools through `brew`, `npm`, or `pnpm`; keep the Nix profile as the only source.

## 4. Uninstall nix-darwin

Use the upstream uninstaller first:

```bash
sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-uninstaller
```

If that command is not available for some reason, try the locally installed fallback:

```bash
sudo darwin-uninstaller
```

## 5. Remove the old nix-darwin checkout

If you used the default `/etc/nix-darwin` checkout and no longer need it, remove it after the uninstaller completes:

```bash
sudo rm -rf /etc/nix-darwin
```

## 6. Verify the new setup

Run the Home Manager switch again and confirm the old casks are gone:

```bash
nixapply
brew list --cask
find "$HOME/Applications" -maxdepth 1 -type l -name '*.app' -print

for app in \
  "Raycast.app" "Google Chrome.app" "Slack.app" "Discord.app" \
  "Spotify.app" "Visual Studio Code.app" "Cursor.app" "OrbStack.app" \
  "MonitorControl.app" "Beekeeper Studio.app" "ChatGPT.app" "Claude.app" \
  "Ghostty.app" "Linear.app" "tldraw offline.app" "Pencil.app" \
  "Recordly.app" "T3 Code (Alpha).app"; do
  test ! -e "/Applications/$app" || echo "duplicate system app: $app"
  test ! -e "$HOME/.nix-profile/Applications/$app" || echo "duplicate profile app: $app"
done

killall Raycast 2>/dev/null || true
```
