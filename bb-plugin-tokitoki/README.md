# Tokitoki Usage for BB

Tokitoki Usage keeps one compact usage indicator fixed to the right edge of
each BB app window. Select it to see quota windows grouped by provider and
account. Account labels, quota values, and display order come from Tokitoki’s
versioned `widget-payload` contract. Provider marks identify the same provider
families in the edge display and account list.

The plugin asks Tokitoki for its cached snapshot every minute. **Refresh** asks
Tokitoki to update that payload without rescanning local session stores. The
Tokitoki menu bar remains responsible for its normal scan and provider polling
cadence. Provider visibility, account order, quota mode, and other settings
continue to live in `~/.config/tokitoki/config.json`.

The plugin runs `tokitoki widget-payload --cached --json` through its
**Tokitoki executable** setting. The Home Manager module points this setting
to the flake-pinned Tokitoki binary. It does not read provider credentials or
copy them into BB storage.
