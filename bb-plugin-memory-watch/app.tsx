import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import type { MemoryReport } from "./contract";
import "./app.css";

const formatScaled = (value: number, units: string[]) => {
  if (value === 0) return `0 ${units[0] ?? "B"}`;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex] ?? "B"}`;
};
const formatMemory = (kb: number) => formatScaled(kb, ["KB", "MB", "GB", "TB"]);
const formatBytes = (bytes: number) =>
  bytes === 0 ? "—" : formatScaled(bytes, ["B", "KB", "MB", "GB", "TB"]);
const formatDuration = (ms: number) =>
  ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`;

function MetricCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <section className="mw-metric" data-accent={accent ? "true" : undefined}>
      <span className="mw-metric-label">{label}</span>
      <strong className="mw-metric-value">{value}</strong>
      <span className="mw-metric-detail">{detail}</span>
    </section>
  );
}

function Page() {
  const rpc = useRpc<typeof rpcContract>();
  const [report, setReport] = useState<MemoryReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showProcesses, setShowProcesses] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await rpc.call("report", null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredPlugins = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query || report === null) return report?.plugins ?? [];
    return report.plugins.filter((plugin) =>
      `${plugin.name} ${plugin.id} ${plugin.status}`.toLocaleLowerCase().includes(query),
    );
  }, [report, search]);

  const measuredMemory = report?.totals.isolatedPluginRssKbExcludingSampler ?? 0;
  const samplerMemoryKb = report?.sampler.rssBytes ? report.sampler.rssBytes / 1024 : 0;
  const measuredCount = report?.totals.pluginsWithMeasuredWorkerMemoryExcludingSampler ?? 0;
  const pluginCount = report?.totals.pluginCount ?? 0;

  return (
    <main className="mw-page">
      <header className="mw-header">
        <div className="mw-heading">
          <div className="mw-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M3 12h4l2.4-7 4.2 14 2.4-7H21" />
            </svg>
          </div>
          <div>
            <h1>Memory Watch</h1>
            <p>See BB memory by process and plugin where BB exposes a separate worker.</p>
          </div>
        </div>
        <div className="mw-actions">
          <span className="mw-updated">
            {report ? `Snapshot ${new Date(report.sampledAt).toLocaleTimeString()}` : "No snapshot yet"}
          </span>
          <button className="mw-button mw-button-secondary" type="button" onClick={() => setShowProcesses((value) => !value)}>
            {showProcesses ? "Hide processes" : "Processes"}
          </button>
          <button className="mw-button mw-button-primary" type="button" onClick={() => void refresh()} disabled={busy}>
            <span className={busy ? "mw-spinner" : "mw-refresh-icon"} aria-hidden="true">↻</span>
            {busy ? "Sampling…" : "Refresh snapshot"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mw-error" role="alert">
          <strong>Snapshot failed</strong>
          <span>{error}</span>
          <button type="button" className="mw-button mw-button-secondary" onClick={() => void refresh()}>Try again</button>
        </div>
      )}

      <section className="mw-metrics" aria-label="Memory totals">
        <MetricCard
          label="BB and discovered workers"
          value={report ? formatMemory(report.totals.bbAppAndPluginRssKb) : "—"}
          detail="Summed process RSS"
          accent
        />
        <MetricCard
          label="Shared BB processes"
          value={report ? formatMemory(report.totals.sharedBbAppRssKb) : "—"}
          detail="App, server and renderers"
        />
        <MetricCard
          label="Isolated plugin workers"
          value={report ? formatMemory(measuredMemory) : "—"}
          detail={report ? `${measuredCount} of ${Math.max(0, pluginCount - 1)} other plugins` : "No data"}
        />
        <MetricCard
          label="Memory Watch overhead"
          value={report ? formatMemory(samplerMemoryKb) : "—"}
          detail={report ? `${formatMemory(report.sampler.heapUsedBytes / 1024)} worker heap` : "Sampler process"}
        />
      </section>

      <div className="mw-notice">
        <span className="mw-info-icon" aria-hidden="true">i</span>
        <p>
          Shares compare only separately launched plugin processes. Plugins running inside BB’s shared
          server or renderer show <strong>Shared</strong>; BB does not expose their individual RAM use.
          Handler time and UI bundle size are clues, not memory measurements. RSS sums can count shared pages twice.
        </p>
      </div>

      <section className="mw-panel">
        <div className="mw-panel-header">
          <div>
            <h2>Plugin breakdown</h2>
            <p>Isolated worker memory, CPU and activity for {pluginCount || "all"} installed plugins.</p>
          </div>
          <label className="mw-search">
            <span className="mw-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Filter plugins"
              aria-label="Filter plugins"
            />
          </label>
        </div>

        <div className="mw-table-scroll">
          <table className="mw-table">
            <thead>
              <tr>
                <th scope="col">Plugin</th>
                <th scope="col">Worker RSS</th>
                <th scope="col">Measured share</th>
                <th scope="col">CPU</th>
                <th scope="col">Handler activity</th>
                <th scope="col">Services</th>
                <th scope="col">UI bundle</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlugins.map((plugin) => (
                <tr key={plugin.id}>
                  <td>
                    <div className="mw-plugin-name">{plugin.name}</div>
                    <div className="mw-subline">{plugin.id}</div>
                  </td>
                  <td>
                    {plugin.workerProcessCount > 0 ? (
                      <>
                        <strong>{formatMemory(plugin.workerRssKb)}</strong>
                        <div className="mw-subline">
                          {plugin.workerProcessCount} {plugin.workerProcessCount === 1 ? "process" : "processes"}
                        </div>
                      </>
                    ) : (
                      <span className="mw-shared">Shared</span>
                    )}
                  </td>
                  <td>
                    {plugin.isSampler ? (
                      <span className="mw-subline">Sampler</span>
                    ) : plugin.isolatedWorkerSharePercent === null ? (
                      <span className="mw-subline">—</span>
                    ) : (
                      <div className="mw-share">
                        <span>{plugin.isolatedWorkerSharePercent.toFixed(1)}%</span>
                        <span className="mw-share-track" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, plugin.isolatedWorkerSharePercent)}%` }} />
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {plugin.workerProcessCount > 0 ? `${plugin.workerPsCpuPercent.toFixed(1)}%` : "—"}
                    <div className="mw-subline">ps %CPU</div>
                  </td>
                  <td>
                    <strong>{plugin.handlerCount.toLocaleString()} calls</strong>
                    <div className="mw-subline">
                      {formatDuration(plugin.handlerTotalMs)}
                      {plugin.handlerErrorCount > 0 ? ` · ${plugin.handlerErrorCount} errors` : ""}
                    </div>
                  </td>
                  <td>
                    <strong>{plugin.activeServiceCount}</strong>
                    <div className="mw-subline">{plugin.scheduleCount} schedules</div>
                  </td>
                  <td>{formatBytes(plugin.frontendBundleBytes)}</td>
                  <td>
                    <span className="mw-state" data-enabled={plugin.enabled ? "true" : "false"}>
                      <span className="mw-state-dot" />
                      {plugin.enabled ? plugin.status : "disabled"}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredPlugins.length === 0 && (
                <tr>
                  <td className="mw-empty" colSpan={8}>No plugins match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {busy && <div className="mw-loading-line" />}
      </section>

      {showProcesses && report && (
        <section className="mw-panel mw-process-panel">
          <div className="mw-panel-header">
            <div>
              <h2>Process details</h2>
              <p>Largest BB and plugin processes first.</p>
            </div>
            <span className="mw-process-count">{report.processes.length} processes</span>
          </div>
          <div className="mw-table-scroll">
            <table className="mw-table mw-process-table">
              <thead>
                <tr>
                  <th scope="col">PID</th>
                  <th scope="col">Role</th>
                  <th scope="col">Plugin</th>
                  <th scope="col">RSS</th>
                  <th scope="col">ps %CPU</th>
                  <th scope="col">Parent</th>
                </tr>
              </thead>
              <tbody>
                {report.processes.map((process) => (
                  <tr key={process.pid}>
                    <td className="mw-mono">{process.pid}</td>
                    <td>{process.role}</td>
                    <td>{process.pluginId ?? "BB"}</td>
                    <td><strong>{formatMemory(process.rssKb)}</strong></td>
                    <td>{process.psCpuPercent.toFixed(1)}%</td>
                    <td className="mw-mono">{process.parentPid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mw-footer">
        <span>Read-only sampling. No plugins are stopped or changed.</span>
        {report && <span>{report.hostPlatform} · {new Date(report.sampledAt).toLocaleString()}</span>}
      </footer>
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "memory-overview",
    title: "Memory Watch",
    icon: "Activity",
    path: "memory",
    component: Page,
  });
});
