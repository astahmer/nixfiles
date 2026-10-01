# Memory Watch

Memory Watch reports BB app and helper process RSS, then attributes process RSS and operating system `ps %CPU` to a plugin only when BB runs that plugin in a separate host, provider bridge, or plugin MCP process. It also shows plugin handler activity, running service counts, and frontend bundle sizes as investigative clues.

## Install and use

Open **Memory Watch** from the BB sidebar to see a visual plugin breakdown. The page takes one snapshot when opened; select **Refresh snapshot** to sample again. The **Processes** button expands the per-process table.

```sh
bb plugin install .
bb memory-watch report
bb memory-watch report --processes
bb memory-watch report --json
```

This plugin samples on demand. It does not stop BB, disable plugins, or run a background poller. Its host worker starts for the snapshot and is included in the process report; its own memory is shown as sampler overhead and excluded from other plugins' share percentages.

## Attribution limits

BB runs many plugin server handlers and frontend bundles inside shared server and renderer processes. Its SDK does not expose per-plugin heap allocations or RSS for that shared code. Those plugins appear with `shared` attribution and no per-plugin memory number. Handler activity and bundle size are not memory measurements.

RSS is resident process memory. Summing process RSS can count shared pages more than once. The BB app total includes app/helper processes and discovered plugin workers; it excludes provider/model subprocesses that cannot be identified from plugin worker paths.
