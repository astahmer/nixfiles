# macOS Removal Plan

This plan assumes the standalone Home Manager profile is already working:

```bash
home-manager switch --flake /Users/astahmer/dev/alex/nixfiles#macbook
```

Keep Nix itself installed. Home Manager still depends on it.

## 1. Remove the apps that are now declarative

These apps are now managed by Home Manager and should no longer be kept by Homebrew:

```bash
brew uninstall --cask background-music orbstack slack shottr karabiner-elements
brew cleanup
```

If Homebrew is no longer needed for anything else, untap the default repositories after the casks are gone:

```bash
brew untap homebrew/homebrew-core
brew untap homebrew/homebrew-cask
```

## 2. Audit the binaries that should come from Nix

These commands should resolve only to Nix-managed paths such as `~/.nix-profile/bin` or `/nix/store`.
If `where` shows `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, or any other global prefix,
remove that duplicate before relying on the Nix profile.

```bash
for bin in bat code comma deadnix docker ffmpeg fnm fzf gh htop hyperfine jj jj-starship jjui jq lazydocker mcfly ncdu neovim nixd nixfmt rg tokei tree tmux uv yt-dlp zeditor; do
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

## 3. Uninstall nix-darwin

Use the upstream uninstaller first:

```bash
sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-uninstaller
```

If that command is not available for some reason, try the locally installed fallback:

```bash
sudo darwin-uninstaller
```

## 4. Remove the old nix-darwin checkout

If you used the default `/etc/nix-darwin` checkout and no longer need it, remove it after the uninstaller completes:

```bash
sudo rm -rf /etc/nix-darwin
```

## 5. Verify the new setup

Run the Home Manager switch again and confirm the old casks are gone:

```bash
home-manager switch -b backup --flake /Users/astahmer/dev/alex/nixfiles#macbook
brew list --cask
```
