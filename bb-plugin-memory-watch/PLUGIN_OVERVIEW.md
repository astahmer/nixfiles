Memory Watch shows current BB app and helper memory alongside memory measured for separately launched plugin workers. It adds each plugin's handler activity, running services, and frontend bundle size to help investigate possible causes without changing plugin state.

Open the Memory Watch sidebar page for a visual overview, then refresh on demand or expand the process table for PID-level details. The `bb memory-watch report` command provides the same data in a terminal.

Plugins that run inside BB's shared server or renderer cannot receive a per-plugin memory value through the current SDK. Memory Watch labels those plugins as shared and reports the unassigned process total separately. Use `bb memory-watch report --processes` for process-level details or `--json` to keep a snapshot for comparison.
