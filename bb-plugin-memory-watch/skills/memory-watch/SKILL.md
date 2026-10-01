---
name: memory-watch
description: Take a read-only snapshot of BB process memory and compare per-plugin isolated worker RSS, CPU, handler activity, services, and UI bundle sizes.
---

# Memory Watch

Open the **Memory Watch** sidebar page for a visual view. It takes a snapshot on entry; use **Refresh snapshot** to sample again and **Processes** to expand PID-level details. Run `bb memory-watch report` for the same information in a terminal. Both are read-only and leave plugin state alone.

## Commands

- `bb memory-watch report` prints the current process and plugin summary.
- Add `--processes` to list measured BB and plugin worker processes with PID, RSS, and CPU.
- Add `--json` for bounded machine-readable output.

## Reading the report

A plugin's RSS and share are measured only when BB launches a separate plugin host, provider bridge, or plugin MCP process for it. The share denominator is the sum of those isolated worker RSS values, excluding Memory Watch's own sampler process. The CPU column is the operating system's `ps %CPU` value for those processes.

Plugins with no separate worker show `shared`. Their server or frontend code runs inside BB's shared server or renderer. BB's current plugin SDK has no per-plugin heap or RSS counters for those processes, so the report cannot assign that shared memory to individual plugins.

Handler counts and time, service counts, and frontend bundle bytes can help pick candidates for a controlled follow-up comparison. They are not memory measurements. RSS sums may count shared memory pages more than once.
