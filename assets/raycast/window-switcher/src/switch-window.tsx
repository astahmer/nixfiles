import { Action, ActionPanel, Icon, List, open, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { focusWindow, herdrFocusWorkspace, herdrWorkspaces, listWindowsCached, HerdrWorkspace, ListResult, WinInfo } from "./lib/helper";

interface HerdrMatch {
  workspaceId: string;
  label: string;
}

export default function Command() {
  const [result, setResult] = useState<ListResult | null>(null);
  const [workspaces, setWorkspaces] = useState<HerdrWorkspace[] | null>(null);
  const [searchText, setSearchText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
  const PER_SECTION_CAP = 8;

  useEffect(() => {
    let alive = true;
    // stale-while-revalidate: instant paint from cache, fresh scan behind it
    listWindowsCached()
      .then(({ data }) => alive && setResult(data))
      .catch((err) => alive && setMessage(String(err?.message ?? err)));
    herdrWorkspaces().then((ws) => alive && setWorkspaces(ws));
    return () => {
      alive = false;
    };
  }, []);

  function rescan() {
    setResult(null);
    listWindowsCached(0) // maxAge 0 forces a fresh scan
      .then(({ data }) => setResult(data))
      .catch((err) => setMessage(String(err?.message ?? err)));
  }

  async function refreshAfterAction() {
    try {
      const { data } = await listWindowsCached(0);
      setResult(data);
    } catch {}
  }
  void refreshAfterAction;

  function toast(style: Toast.Style, title: string, message?: string) {
    void showToast({ style, title, message });
  }

  async function handleFocus(win: WinInfo) {
    const status = await focusWindow(win)
      .catch((err) => `error: ${err instanceof Error ? err.message : String(err)}`);
    if (!status.startsWith("ok")) {
      setMessage(`Could not focus "${win.title || win.owner}": ${status}`);
      toast(Toast.Style.Failure, "Focus failed", String(status));
    }
    await refreshAfterAction();
  }

  async function handleHerdr(match: HerdrMatch, win: WinInfo) {
    const ok = await herdrFocusWorkspace(match.workspaceId);
    if (!ok) {
      toast(Toast.Style.Failure, "herdr workspace focus failed");
      return;
    }
    await handleFocus(win); // raise the window/space that hosts it
    toast(Toast.Style.Success, `herdr workspace: ${match.label}`);
  }

  /** Match a window title against herdr workspace labels ("~/dev/emisoup" ⊃ "emisoup"). */
  function herdrMatchFor(win: WinInfo): HerdrMatch | null {
    if (!workspaces || !win.title || win.title.length < 3) return null;
    const t = win.title.toLowerCase();
    for (const ws of workspaces) {
      const label = ws.label?.toLowerCase();
      if (label && label.length > 2 && t.includes(label)) {
        return { workspaceId: ws.workspace_id, label: ws.label };
      }
    }
    return null;
  }

  const query = searchText.toLowerCase();
  const filtered = useMemo(
    () => (result?.windows ?? []).filter((w) => !query || `${w.owner} ${w.title}`.toLowerCase().includes(query)),
    [result, query],
  );

  const sections = useMemo(() => {
    const map = new Map<string, WinInfo[]>();
    for (const win of filtered) {
      if (!map.has(win.owner)) map.set(win.owner, []);
      map.get(win.owner)?.push(win);
    }
    for (const wins of map.values()) {
      wins.sort((a, b) => Number(b.onscreen) - Number(a.onscreen) || a.y - b.y || a.x - b.x);
    }
    return [...map.entries()].sort((a, b) => {
      const aOn = Math.max(...a[1].map((w) => Number(w.onscreen)));
      const bOn = Math.max(...b[1].map((w) => Number(w.onscreen)));
      return bOn - aOn || a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  const manyUntitled = result !== null && result.total > 0 && result.untitled > result.total / 2;

  return (
    <List
      isLoading={result === null}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={false}
      throttle
      searchBarPlaceholder="Filter by app or window title…"
    >
      {manyUntitled && (
        <List.Section title="⚠️ Some titles hidden">
          <List.Item
            title="Grant Screen Recording to the window-switcher helper for cross-Space titles"
            subtitle="System Settings → Privacy"
            icon={Icon.ExclamationMark}
            actions={
              <ActionPanel>
                <Action
                  title="Open Privacy Settings"
                  icon={Icon.Gear}
                  onAction={() =>
                    open("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                  }
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      {sections.map(([app, wins]) => (
        <List.Section key={app} title={app} subtitle={String(wins.length)}>
          {(expandedApps.has(app) ? wins : wins.slice(0, PER_SECTION_CAP)).map((win, idx) => {
            const hm = app === "Ghostty" ? herdrMatchFor(win) : null;
            return (
              <List.Item
                key={`${win.pid}-${win.cgid}`}
                icon={win.path ? { fileIcon: win.path } : Icon.Window}
                title={win.title || `(untitled #${idx + 1} · ${win.cgid})`}
                accessories={[
                  { text: win.onscreen ? "visible" : "other space" },
                  { text: `${Math.round(win.w)}×${Math.round(win.h)}` },
                ]}
                actions={
                  <ActionPanel>
                    <Action title="Focus Window" icon={Icon.ArrowRight} onAction={() => handleFocus(win)} />
                    {hm && (
                      <Action
                        title={`Focus herdr workspace “${hm.label}”`}
                        icon={Icon.Terminal}
                        onAction={() => handleHerdr(hm, win)}
                      />
                    )}
                    <Action.CopyToClipboard
                      title="Copy Window Title"
                      content={win.title}
                      shortcut={{ modifiers: ["cmd"], key: "." }}
                    />
                    <Action title="Rescan Windows" icon={Icon.RotateAntiClockwise} onAction={rescan} />
                  </ActionPanel>
                }
              />
            );
          })}
          {!expandedApps.has(app) && wins.length > PER_SECTION_CAP && (
            <List.Item
              key={`${app}-more`}
              title={`Show ${wins.length - PER_SECTION_CAP} more…`}
              icon={Icon.ChevronDown}
              actions={
                <ActionPanel>
                  <Action
                    title="Show All"
                    onAction={() => setExpandedApps(new Set([...expandedApps, app]))}
                  />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      ))}
      {result !== null && sections.length === 0 && !manyUntitled && (
        <List.EmptyView title="No windows found" description="Try Rescan, or check Accessibility permissions." />
      )}
      {message && (
        <List.Section title="Last message">
          <List.Item title={message} icon={Icon.Message} />
        </List.Section>
      )}
    </List>
  );
}
