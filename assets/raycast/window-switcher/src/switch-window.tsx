import { Action, ActionPanel, Icon, List, open } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { focusWindow, listWindows, WinInfo } from "./lib/helper";

export default function Command() {
  const [result, setResult] = useState<{ windows: WinInfo[]; titlesEmpty: boolean } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [focusMessage, setFocusMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listWindows()
      .then((r) => alive && setResult(r))
      .catch((err) => {
        console.error(err);
        if (alive) setFocusMessage(String(err?.message ?? err));
      });
    return () => {
      alive = false;
    };
  }, []);

  function rescan() {
    setResult(null);
    listWindows()
      .then(setResult)
      .catch((err) => setFocusMessage(String(err?.message ?? err)));
  }

  async function handleFocus(win: WinInfo) {
    try {
      const status = await focusWindow(win);
      // activating the target dismisses the Raycast panel by itself
      if (!status.startsWith("ok")) {
        setFocusMessage(
          `${status} — grant Raycast Screen Recording + Accessibility + Automation(System Events) in System Settings → Privacy, then quit & reopen Raycast`,
        );
      }
    } catch (err) {
      setFocusMessage(String(err instanceof Error ? err.message : err));
    }
    void listWindows().then(setResult).catch(() => {});
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
    // apps with an on-screen window float to the top
    return [...map.entries()].sort((a, b) => {
      const aOn = Math.max(...a[1].map((w) => Number(w.onscreen)));
      const bOn = Math.max(...b[1].map((w) => Number(w.onscreen)));
      return bOn - aOn || a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  const screenRecordingWarning = result?.titlesEmpty === true;

  return (
    <List
      isLoading={result === null}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      filtering={false}
      throttle
      searchBarPlaceholder="Filter by app or window title…"
    >
      {screenRecordingWarning && (
        <List.Section title="⚠️ Titles hidden">
          <List.Item
            title="Grant Screen Recording to Raycast for window titles"
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
                <Action.CopyToClipboard title="Copy Debug Info" content={JSON.stringify(result)} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      {sections.map(([app, wins]) => (
        <List.Section key={app} title={app} subtitle={String(wins.length)}>
          {wins.map((win, idx) => (
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
                  <Action.CopyToClipboard
                    title="Copy Window Title"
                    content={win.title}
                    shortcut={{ modifiers: ["cmd"], key: "." }}
                  />
                  <Action title="Rescan Windows" icon={Icon.RotateAntiClockwise} onAction={rescan} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
      {result !== null && sections.length === 0 && !screenRecordingWarning && (
        <List.EmptyView title="No windows found" description="Try Rescan, or check Accessibility permissions." />
      )}
      {focusMessage && (
        <List.Section title="Last message">
          <List.Item title={focusMessage} icon={Icon.Message} />
        </List.Section>
      )}
    </List>
  );
}
