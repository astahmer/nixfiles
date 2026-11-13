# DSH runtime tools on Raspberry Pi OS

The multi-host plugin provisions DSH over SSH and needs `fnm` (for the official
Node build), `jj` (for the dshfiles checkout) and the `pnpm` that dshfiles pins
in `packageManager` on the non-interactive SSH `PATH`. That `PATH` already
starts with `~/.nix-profile/bin`, so this flake goes into the user's default Nix
profile. fnm and jj come from the Nixpkgs binary cache; pnpm is the official
standalone ARM64 release archive. Nothing is compiled on the Pi.

```sh
ssh raspberrypi@raspberrypi 'mkdir -p ~/.local/share/dsh-runtime-tools'
scp hosts/raspberrypi/dsh-runtime/flake.nix hosts/raspberrypi/dsh-runtime/flake.lock \
  raspberrypi@raspberrypi:~/.local/share/dsh-runtime-tools/
ssh raspberrypi@raspberrypi \
  'nix --extra-experimental-features "nix-command flakes" profile add ~/.local/share/dsh-runtime-tools'
```

Upgrade by refreshing `flake.lock` here, copying it again, and running
`nix profile upgrade dsh-runtime-tools` on the Pi.
