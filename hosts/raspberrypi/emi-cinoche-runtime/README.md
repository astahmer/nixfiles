# Emi Cinoche runtime on Raspberry Pi OS

This standalone flake pins official ARM64 Node.js 24.21.0 and Cloudflare
cloudflared 2026.9.3 binaries with upstream SHA-256 checksums, plus cached
ARM64 geckodriver from its locked Nixpkgs revision. It works on the Pi's
existing Debian/Raspberry Pi OS installation; it does not replace the
operating system or manage Firefox.

Nix itself is bootstrapped once with the official multi-user installer. That
mode is supported on Linux with systemd and no SELinux, and uses `sudo` for
system setup. Keep the install separate from the runtime profile below.

Copy this directory to `~/.local/share/emi-cinoche/runtime` on the Pi and
install its default package into a dedicated profile:

```sh
ssh raspberrypi@raspberrypi \
  'mkdir -p ~/.local/share/emi-cinoche/runtime ~/.local/state/nix/profiles'
scp hosts/raspberrypi/emi-cinoche-runtime/flake.nix \
  hosts/raspberrypi/emi-cinoche-runtime/flake.lock \
  raspberrypi@raspberrypi:~/.local/share/emi-cinoche/runtime/
ssh raspberrypi@raspberrypi \
  'nix profile add --profile ~/.local/state/nix/profiles/emi-cinoche-runtime ~/.local/share/emi-cinoche/runtime'
```

The profile is separate from the user's default profile. Its `bin` directory
contains `node`, `geckodriver`, and `cloudflared`; it also contains systemd unit
files under `share/emi-cinoche/systemd`. Install those units as symlinks in
`/etc/systemd/system`, then enable them with `systemctl`. The geckodriver unit
binds only to loopback. The cloudflared unit reads its connector token as a
systemd credential from `/var/lib/emi-cinoche-cloudflared/tunnel-token` and
uses QUIC for Workers VPC. Store the token in the secret manager and never in
this source tree. Keep browser profiles and Pathé cookies outside this tree.
