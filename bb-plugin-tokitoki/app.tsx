import { useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import "./app.css";

type Account = {
  provider: string;
  accountId: string;
  label: string;
  remainingPercent: number | null;
  metric: string | null;
  detail: string | null;
  capturedAt: number | null;
};
type Usage = { accounts: Account[]; capturedAt: number | null; error: string | null };

const emptyUsage: Usage = { accounts: [], capturedAt: null, error: null };
const providerNames: Record<string, string> = {
  "claude-code": "Claude Code",
  claude: "Claude Code",
  codex: "Codex",
  copilot: "Copilot",
  "github-copilot": "Copilot",
  commandcode: "CommandCode",
  cursor: "Cursor",
  pi: "Pi",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  t3code: "T3 Code",
  "antigravity-cli": "Antigravity",
};
const providerColors: Record<string, string> = {
  "claude-code": "#D97757",
  claude: "#D97757",
  codex: "#10A37F",
  copilot: "#8B5CF6",
  "github-copilot": "#8B5CF6",
  commandcode: "#0EA5E9",
  cursor: "#E5E7EB",
  pi: "#EAB308",
  opencode: "#F97316",
  "opencode-go": "#F97316",
  openrouter: "#6366F1",
  t3code: "#EC4899",
  "antigravity-cli": "#4285F4",
};

const ProviderMark = ({ provider }: { provider: string }) => {
  const color = providerColors[provider] ?? "#8B9AAF";
  if (provider === "claude-code") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.7 11.7 7l5.2-2.5-3.8 4.4 5.2 1.4-5.4.6 2.2 5.3-4-3.7-2.8 5-.1-5.4-5.2 2.7 3.4-4.7-5.4-.9 5.3-.9-2.5-5 4.1 3.5z" fill={color} /></svg>;
  if (provider === "codex") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2 15.6 5.4v6.5L10 15.2l-5.6-3.3V5.4L10 2.2Z" fill="none" stroke={color} strokeWidth="1.7" /><path d="M4.7 5.8 10 9l5.3-3.2M10 9v6" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (provider === "copilot") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7.2C3 5.4 4.5 4 6.3 4h7.4C15.5 4 17 5.4 17 7.2v5.6c0 1.8-1.5 3.2-3.3 3.2H6.3C4.5 16 3 14.6 3 12.8V7.2Z" fill={color} opacity=".92" /><path d="M6.2 9h.1m7.4 0h.1M7 12c1.7 1.2 4.3 1.2 6 0" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (provider === "pi") return <span className="tu-mark tu-mark-pi" style={{ color }}>π</span>;
  if (provider === "opencode") return <span className="tu-mark" style={{ color }}>&lt;/&gt;</span>;
  if (provider === "cursor") return <span className="tu-mark" style={{ color }}>◉</span>;
  if (provider === "t3code") return <span className="tu-mark tu-mark-t3" style={{ color }}>T3</span>;
  return <span className="tu-mark" style={{ color }}>✦</span>;
};

const usageLabel = (account: Account) => account.metric ? account.metric.replaceAll("_", " ") : "Usage";
const shortPercent = (value: number | null) => value === null ? "—" : `${Math.round(value)}%`;
const toneFor = (value: number | null) => value === null ? "unknown" : value <= 10 ? "critical" : value <= 25 ? "low" : "healthy";

const EdgeWidget = () => {
  const rpc = useRpc<typeof rpcContract>();
  const [usage, setUsage] = useState<Usage>(emptyUsage);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const next = await rpc.call(refresh ? "refresh" : "usage", null);
      setUsage(next);
    } catch {
      setUsage({ ...emptyUsage, error: "Could not read Tokitoki’s cached usage." });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const primary = useMemo(() => usage.accounts
    .filter((account) => account.remainingPercent !== null)
    .sort((left, right) => (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101))[0] ?? usage.accounts[0], [usage.accounts]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Account[]>();
    for (const account of usage.accounts) {
      const key = `${account.provider}:${account.accountId}`;
      const existing = groups.get(key) ?? [];
      existing.push(account);
      groups.set(key, existing);
    }
    return [...groups.values()];
  }, [usage.accounts]);

  return <aside className="tu-edge-root" aria-label="Tokitoki usage">
    <button className={`tu-edge-trigger ${open ? "is-open" : ""}`} type="button" aria-expanded={open} aria-label={primary ? `${providerNames[primary.provider] ?? primary.provider}, ${primary.label}, ${shortPercent(primary.remainingPercent)} remaining` : "Open Tokitoki usage"} title={primary ? `${providerNames[primary.provider] ?? primary.provider} · ${primary.label} · ${shortPercent(primary.remainingPercent)}` : "Tokitoki usage"} onClick={() => setOpen((value) => !value)}>
      {primary ? <ProviderMark provider={primary.provider} /> : <span className="tu-mark">T</span>}
      {primary?.remainingPercent !== null && primary?.remainingPercent !== undefined ? <span className={`tu-edge-value is-${toneFor(primary.remainingPercent)}`}>{Math.round(primary.remainingPercent)}</span> : <span className="tu-edge-value">{usage.accounts.length || "·"}</span>}
    </button>
    {open ? <section className="tu-popover" aria-label="Tokitoki usage details">
      <header className="tu-popover-header"><div><strong>Tokitoki</strong><span>{grouped.length} {grouped.length === 1 ? "account" : "accounts"}</span></div><button type="button" className="tu-icon-button" onClick={() => void load(true)} disabled={refreshing} aria-label="Refresh Tokitoki usage" title="Refresh">{refreshing ? "…" : "↻"}</button><button type="button" className="tu-icon-button" onClick={() => setOpen(false)} aria-label="Close Tokitoki usage">×</button></header>
      {loading && usage.accounts.length === 0 ? <p className="tu-state">Loading usage…</p> : null}
      {usage.error ? <p className="tu-state tu-error">{usage.error}</p> : null}
      {!usage.error && !loading && usage.accounts.length === 0 ? <p className="tu-state">No quota snapshot is available yet. Tokitoki’s menu bar updates this cache in the background.</p> : null}
      <div className="tu-account-list">{grouped.map((entries) => {
        const first = entries[0];
        return <article className="tu-account" key={`${first.provider}:${first.accountId}`}>
          <header><span className="tu-provider-icon"><ProviderMark provider={first.provider} /></span><span className="tu-account-name"><strong>{first.label}</strong><small>{providerNames[first.provider] ?? first.provider}</small></span></header>
          <div className="tu-windows">{entries.map((entry) => <div className="tu-window" key={`${entry.provider}:${entry.accountId}:${entry.metric ?? "usage"}`}>
            <div className="tu-window-heading"><span>{usageLabel(entry)}</span><strong className={`is-${toneFor(entry.remainingPercent)}`}>{shortPercent(entry.remainingPercent)}</strong></div>
            {entry.remainingPercent !== null ? <div className="tu-track" role="progressbar" aria-label={`${entry.label} ${usageLabel(entry)} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.remainingPercent}><span className={`is-${toneFor(entry.remainingPercent)}`} style={{ width: `${entry.remainingPercent}%` }} /></div> : null}
            {entry.detail ? <small className="tu-window-detail">{entry.detail}</small> : null}
          </div>)}</div>
        </article>;
      })}</div>
      <footer>{usage.capturedAt ? `Updated ${new Date(usage.capturedAt).toLocaleTimeString()}` : "Values follow Tokitoki’s cached snapshot"}</footer>
    </section> : null}
  </aside>;
};

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "tokitoki-edge-usage", component: EdgeWidget });
});
