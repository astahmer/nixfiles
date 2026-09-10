#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
package_file="$repo_root/packages/whatsapp-bin/default.nix"
release_url="https://web.whatsapp.com/desktop/mac_native/release/?configuration=Release&src=whatsapp_downloads_desktop_page"

resolved_url="$(curl -fsSL --retry 3 -o /dev/null -w '%{url_effective}' "$release_url")"
version="$(printf '%s\n' "$resolved_url" | sed -n 's#.*WhatsApp-\([0-9][0-9.]*\)\.dmg.*#\1#p')"
if [ -z "$version" ]; then
  printf 'update-whatsapp: could not determine the release version from %s\n' "$resolved_url" >&2
  exit 1
fi

current_version="$(sed -n 's/^[[:space:]]*version = "\([^"]*\)";/\1/p' "$package_file" | head -1)"
if [ "$current_version" = "$version" ]; then
  printf 'update-whatsapp: %s is already current\n' "$version"
  exit 0
fi

download_url="https://web.whatsapp.com/desktop/mac_native/release/?version=${version}&extension=dmg&configuration=Release&branch=master"
tmp_dir="$(mktemp -d)"
backup_file="$tmp_dir/whatsapp-bin.default.nix"
download_file="$tmp_dir/WhatsApp-${version}.dmg"
updated=0

cleanup() {
  if [ "$updated" -eq 0 ]; then
    cp "$backup_file" "$package_file"
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
cp "$package_file" "$backup_file"

curl -fL --retry 3 --output "$download_file" "$download_url"
hash="$(nix hash file --type sha256 --sri "$download_file")"
VERSION="$version" HASH="$hash" perl -0pi -e 's/version = "[^"]+";/version = "$ENV{VERSION}";/; s/hash = "sha256-[^"]+";/hash = "$ENV{HASH}";/' "$package_file"

store_path="$(nix build "$repo_root#whatsapp-bin" --no-link --print-out-paths)"
app_path="$store_path/Applications/WhatsApp.app"
expected_app_version="${version#2.}"
actual_app_version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$app_path/Contents/Info.plist")"
if [ "$actual_app_version" != "$expected_app_version" ]; then
  printf 'update-whatsapp: expected app version %s, got %s\n' "$expected_app_version" "$actual_app_version" >&2
  exit 1
fi
/usr/bin/codesign --verify --deep --strict "$app_path"
updated=1
printf 'update-whatsapp: pinned signed WhatsApp %s (%s)\n' "$version" "$hash"
