# SecretBar on Linux — evaluation notes & plan

Status: **not started** (deliberately). This file records what we learned in
the 2026-08-24 session so a future attempt doesn't re-litigate everything.

The macOS app (`packages/secretbar`, Swift/AppKit) remains the primary
implementation. A Linux equivalent would be a **second frontend**, not a
port: only the model logic (vault state machine + `bw`/`secret` CLI
orchestration) transfers.

## Why not Swift

Swift *does* compile on Linux — the blocker is Apple-only frameworks:
`AppKit`/`SwiftUI`, Keychain, `LocalAuthentication`, launchd integration.
Roughly: the model layer is portable, 100% of UI/security backends are not.

## Stacks evaluated

| Stack | Verdict |
| --- | --- |
| Rust + gtk4-rs + libadwaita (+ ksni tray, gtk4-layer-shell) | Most native-looking, but 3 niche libraries duct-taped together. Rejected as too obscure/high-maintenance. |
| Electron | Everything first-party (Tray, ContextMenu, frameless window, safeStorage → Keychain/libsecret, `setLoginItemSettings`). Cost: ~150MB binary, ~100–300MB resident RAM for a background utility. Boring-but-safe fallback. |
| Tauri 2 | Small + official plugins (tray, autostart), but thin Rust shell + WebKitGTK quirks on Linux. |
| Wails (Go) | No mature tray support — dealbreaker for a tray-first app. |
| Flutter / Avalonia | Custom-drawn UI, looks native nowhere. |
| Qt | Only if targeting KDE Plasma desktops. |

## Chosen direction: Electrobun

Same runtime/toolchain as `~/dev/shiftshift` (hutch CLI; hutch 0.24.3 ↔
electrobun 2.0.1 pin — see shiftshift `flake.nix` for the pinning pattern,
including the macOS signing plist patch script).

Why it fits:

- `Tray` + `ContextMenu` APIs cover the exact interaction model (left click
  panel, right-click lock/unlock/quit).
- No keychain API needed: SecretBar never stores values itself, it drives
  the `bw`/`secret` CLI via plain process spawn — fully portable.
- Autostart should be Nix-managed anyway (systemd **user** unit in a
  home-manager module on `hosts/workstation`, mirroring the launchd agent
  in `modules/macos-apps.nix`) rather than any framework API.
- Tiny binary (~15MB) vs Electron's ~150MB for a resident app.
- One TypeScript codebase could eventually serve both OSes.

Known risks:

- Electrobun is young; **Linux is its least-mature target** (application
  menus unsupported on Linux at time of writing; stability milestones still
  open — see github.com/blackboardsh/electrobun/issues/2 roadmap).
- Tray-icon behavior is desktop-dependent (GNOME needs AppIndicator
  extension; Wayland vs X11 differ). Panel-under-tray positioning may be
  flaky under Wayland; fallback = normal Adw/Electrobun window launched
  from the tray menu.

## Testing without a Linux machine

Layered, cheapest first:

1. **Vitest unit tests** on the TS core (state machine, CLI orchestration)
   — platform-free, run everywhere. Covers most regression surface.
2. **GitHub Actions smoke job** (`ubuntu-latest`): install webkitgtk +
   xvfb, launch under `xvfb-run`, assert process alive + screenshot
   artifact. Catches crash-on-launch and missing-library failures every
   push.
3. **Local NixOS VM** (UTM on Apple Silicon, running our own
   `hosts/workstation` flake or a NixOS ISO): manual UX validation — tray,
   context menu, panel positioning, clipboard, theming; toggle X11 vs
   Wayland sessions inside the VM.
4. **Optional real hardware** (used mini PC / ThinkPad) only when
   daily-driving it.

## Build sequence (when picked up)

1. Scaffold `packages/secretbar-electrobun/`: tray + context menu + panel
   window on **macOS first** (mature target); port `SecretBarModel` state
   machine to TS with vitest coverage.
2. Add the CI smoke job the same day as scaffolding.
3. Linux build via hutch; validate in the NixOS VM before any UI polish.
4. Package: `packages/<name>/default.nix` (callPackage convention) +
   workstation home-manager module (app + systemd user unit).
5. Escape hatch: the TS core ports to an Electron shell nearly unchanged
   if Electrobun's Linux target blocks us.

## Related

- macOS implementation: `packages/secretbar/Sources/secretbar/`
- Vault CLI: `packages/secret/`
- Roadmap context: `docs/secret-v2-roadmap.md`
