# macOS Removal Plan

This plan assumes the standalone Home Manager profile is already working:

```bash
home-manager switch --flake /Users/astahmer/dev/alex/nixfiles#macbook
```

Keep Nix itself installed. Home Manager still depends on it.

## 1. Remove the apps that are now declarative

These apps are now managed by Home Manager and should no longer be kept by Homebrew:

```bash
brew uninstall --cask orbstack slack shottr
brew cleanup
```

If Homebrew is no longer needed for anything else, untap the default repositories after the casks are gone:

```bash
brew untap homebrew/homebrew-core
brew untap homebrew/homebrew-cask
```

## 2. Uninstall nix-darwin

Use the upstream uninstaller first:

```bash
sudo nix --extra-experimental-features "nix-command flakes" run nix-darwin#darwin-uninstaller
```

If that command is not available for some reason, try the locally installed fallback:

```bash
sudo darwin-uninstaller
```

## 3. Remove the old nix-darwin checkout

If you used the default `/etc/nix-darwin` checkout and no longer need it, remove it after the uninstaller completes:

```bash
sudo rm -rf /etc/nix-darwin
```

## 4. Verify the new setup

Run the Home Manager switch again and confirm the old casks are gone:

```bash
home-manager switch --flake /Users/astahmer/dev/alex/nixfiles#macbook
brew list --cask
```
