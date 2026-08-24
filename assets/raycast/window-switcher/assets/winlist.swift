// window-switcher helper — lists every window across all Spaces and focuses
// a picked one. Compiled on demand by the Raycast extension (src/lib/helper.ts).
//
// Subcommands:
//   list                 -> JSON { windows: [...], titlesEmpty: bool }
//   focus <pid> <cgid> <title> -> status string

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// Private HIServices symbol used by alt-tab & co to map AX windows -> CGWindowIDs
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ ax: AXUIElement, _ out: UnsafeMutablePointer<CGWindowID>) -> AXError

struct Win: Codable {
    let owner: String
    let pid: Int
    let cgid: Int
    let title: String
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    let onscreen: Bool
    let path: String
}

let junkOwners: Set<String> = [
    "CursorUIViewService", "Window Server", "WindowManager", "Window Manager",
    "Dock", "NotificationCenter", "ControlCenter", "TextInputMenuAgent",
    "TextInputSwitcher", "Spotlight", "ScreenSaverEngine",
]

func cgWindows(onlyOnscreen: Bool = false) -> [Win] {
    let opts: CGWindowListOption = onlyOnscreen
        ? [.optionOnScreenOnly, .excludeDesktopElements]
        : [.optionAll, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
    var out: [Win] = []
    var appCache: [Int: NSRunningApplication?] = [:]
    func app(forPid pid: Int) -> NSRunningApplication? {
        if let cached = appCache[pid] { return cached }
        let a = NSRunningApplication(processIdentifier: pid_t(pid))
        appCache[pid] = a
        return a
    }
    for w in list {
        guard w["kCGWindowLayer"] as? Int == 0 else { continue }
        let owner = w["kCGWindowOwnerName"] as? String ?? ""
        if owner.isEmpty || junkOwners.contains(owner) { continue }
        guard let pidNum = w["kCGWindowOwnerPID"] as? Int,
              app(forPid: pidNum)?.activationPolicy == .regular else { continue }
        guard let b = w["kCGWindowBounds"] as? [String: CGFloat] else { continue }
        let bw = b["Width"] ?? 0, bh = b["Height"] ?? 0
        if bw < 150 || bh < 150 { continue }
        // NOTE: do NOT filter on kCGWindowAlpha — windows on other Spaces
        // report alpha 0 and must stay listed.
        out.append(Win(
            owner: owner,
            pid: pidNum,
            cgid: w["kCGWindowNumber"] as? Int ?? -1,
            title: w["kCGWindowName"] as? String ?? "",
            x: b["X"] ?? 0, y: b["Y"] ?? 0, w: bw, h: bh,
            onscreen: w["kCGWindowIsOnscreen"] as? Bool ?? false,
            path: app(forPid: pidNum)?.bundleURL?.path ?? ""
        ))
    }
    return out
}

struct AxWin {
    let el: AXUIElement
    let cgid: CGWindowID?
    let title: String
    let minimized: Bool
}

func axWindows(pid: pid_t) -> [AxWin] {
    let app = AXUIElementCreateApplication(pid)
    // Electron apps only expose their AX tree after this poke
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    var val: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &val) == .success,
          let ws = val as? [AXUIElement] else { return [] }
    var out: [AxWin] = []
    for w in ws {
        var cid: CGWindowID = 0
        let err = _AXUIElementGetWindow(w, &cid)
        var t: CFTypeRef?
        AXUIElementCopyAttributeValue(w, kAXTitleAttribute as CFString, &t)
        var m: CFTypeRef?
        AXUIElementCopyAttributeValue(w, "AXMinimized" as CFString, &m)
        out.append(AxWin(
            el: w,
            cgid: err == .success ? cid : nil,
            title: (t as? String) ?? "",
            minimized: (m as? Bool) ?? false
        ))
    }
    return out
}

/// Light-weight frontmost-window probe (no AppKit lookups — called in polls).
func frontmostWindowCgid(pid: pid_t) -> Int? {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    // list comes back front-to-back
    for w in list {
        guard w["kCGWindowLayer"] as? Int == 0,
              w["kCGWindowOwnerPID"] as? Int == Int(pid) else { continue }
        if let b = w["kCGWindowBounds"] as? [String: CGFloat], (b["Width"] ?? 0) >= 150 {
            return w["kCGWindowNumber"] as? Int
        }
    }
    return nil
}

// Remember dead-end strategies per pid so failures stay fast.
var strategyMemo: [Int: (Date, String)] = [:]
func memoSet(_ pid: Int, _ what: String) { strategyMemo[pid] = (Date(), what) }
func memoHit(_ pid: Int, _ what: String, ttl: TimeInterval) -> Bool {
    guard let m = strategyMemo[pid], m.1 == what, Date().timeIntervalSince(m.0) < ttl else { return false }
    return true
}

/// Light probe: ids of all on-screen windows (any display).
func onscreenIds() -> Set<Int> {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    var ids = Set<Int>()
    for w in list {
        guard w["kCGWindowLayer"] as? Int == 0 else { continue }
        if let b = w["kCGWindowBounds"] as? [String: CGFloat], (b["Width"] ?? 0) >= 150,
           let n = w["kCGWindowNumber"] as? Int { ids.insert(n) }
    }
    return ids
}

// Path 2 fallback: click the app's Window-menu entry for the target title.
// The Window menu lists every window across all Spaces incl. fullscreen ones,
// and System Events' click jumps straight there.
func focusViaWindowMenu(pid: pid_t, title: String) -> String {
    let script = """
    on run argv
      set pid to (item 1 of argv) as integer
      set wtitle to item 2 of argv
      tell application "System Events"
        set p to first application process whose unix id is pid
        set menuNames to {"Window", "Fenêtre", "Ventana", "Fenster", "Finestra", "Janela"}
        set targetMenu to missing value
        repeat with mbi in menu bar items of menu bar 1 of p
          try
            if (name of mbi as text) is in menuNames then set targetMenu to contents of mbi
          end try
        end repeat
        if targetMenu is missing value then return "no-window-menu"
        set items_ to menu items of menu 1 of targetMenu
        repeat with it_ in items_
          try
            if (name of it_ as text) is wtitle then
              click it_
              return "ok-menu"
            end if
          end try
        end repeat
        repeat with it_ in items_
          try
            set nm to name of it_ as text
            if (length of nm) > 3 and (nm ends with wtitle or nm contains wtitle or wtitle contains nm) then
              click it_
              return "ok-menu-fuzzy"
            end if
          end try
        end repeat
        return "not-in-menu"
      end tell
    end run
    """
    return runOsa(script, [String(pid), title]) ?? "osascript-error"
}

func activateApp(_ pid: pid_t) {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return }
    if #available(macOS 14.0, *) {
        app.activate()
    } else {
        app.activate(options: [.activateIgnoringOtherApps])
    }
    usleep(200_000)
}

func hasOnscreenWindow(_ pid: pid_t) -> Bool {
    frontmostWindowCgid(pid: pid) != nil || !cgWindows(onlyOnscreen: true).filter({ $0.pid == Int(pid) }).isEmpty
}

/// Poll until the given cgid is the app's frontmost window.
func verifyLanded(_ pid: pid_t, _ cgid: CGWindowID, timeoutMs: Int) -> Bool {
    let deadline = DispatchTime.now() + .milliseconds(timeoutMs)
    while DispatchTime.now() < deadline {
        if frontmostWindowCgid(pid: pid) == Int(cgid) { return true }
        usleep(80_000)
    }
    return false
}

/// Native-tab apps (Ghostty & co): one AX window, N CG windows, no per-tab
/// menu entries. Cycle "Show Next Tab" until the target CG window is frontmost.
func focusViaTabCycle(pid: pid_t, cgid: CGWindowID) -> String {
    let count = cgWindows().filter { $0.pid == Int(pid) }.count
    guard count > 1 else { return "single-window" }
    let script = """
    on run argv
      set pid to (item 1 of argv) as integer
      tell application "System Events"
        set p to first application process whose unix id is pid
        set menuNames to {"Window", "Fenêtre", "Ventana", "Fenster", "Finestra", "Janela"}
        set nextNames to {"Show Next Tab", "Onglet suivant", "Next Tab"}
        set targetMenu to missing value
        repeat with mbi in menu bar items of menu bar 1 of p
          try
            if (name of mbi as text) is in menuNames then set targetMenu to contents of mbi
          end try
        end repeat
        if targetMenu is missing value then return "no-window-menu"
        repeat with it_ in menu items of menu 1 of targetMenu
          try
            if (name of it_ as text) is in nextNames then
              click it_
              return "ok"
            end if
          end try
        end repeat
        return "no-next-tab-item"
      end tell
    end run
    """
    let maxIters = min(count * 2, 10)
    var lastKey = ""
    var stale = 0
    for _ in 0..<maxIters {
        guard runOsa(script, [String(pid)]) == "ok" else { return "no-tab-menu" }
        var key = ""
        for _ in 0..<2 {
            usleep(180_000)
            if onscreenIds().contains(Int(cgid)) { return "ok-tabs" }
            if let f = frontmostWindowCgid(pid: pid) { key = String(f) }
        }
        // three consecutive clicks with zero movement -> this app's tabs are
        // unreachable from the Window menu; stop burning time
        if !key.isEmpty && key == lastKey {
            stale += 1
            if stale >= 2 { return "tab-cycle-stuck" }
        } else {
            stale = 0
        }
        lastKey = key
    }
    return "tab-cycle-failed"
}

func focusWindow(pid: pid_t, cgid: CGWindowID, title: String) -> String {
    var misses: [String] = []
    // "landed" = target visible on some display (key-ness follows from the
    // activation we perform; requiring topmost breaks with multi-display).
    func landed() -> Bool { onscreenIds().contains(Int(cgid)) }
    func waitLanded(_ ms: Int) -> Bool {
        let deadline = DispatchTime.now() + .milliseconds(ms)
        while DispatchTime.now() < deadline {
            if landed() { return true }
            usleep(80_000)
        }
        return false
    }
    let axWins = axWindows(pid: pid)

    // Path 1: direct AX raise (same Space, normal cross-Space windows, minimized)
    let match =
        axWins.first(where: { $0.cgid == cgid })
        ?? axWins.first(where: { !title.isEmpty && $0.title == title })
    if let m = match {
        for attempt in 0..<2 {
            if m.minimized {
                AXUIElementSetAttributeValue(m.el, "AXMinimized" as CFString, kCFBooleanFalse)
                usleep(60_000)
            }
            activateApp(pid)
            AXUIElementPerformAction(m.el, kAXRaiseAction as CFString)
            if waitLanded(attempt == 0 ? 900 : 700) {
                return attempt == 0 ? "ok-ax" : "ok-ax-retry"
            }
        }
    }

    // Strategy A2: Ghostty-native AppleScript — its dictionary exposes
    // windows -> tabs with a settable `selected`; selecting makes Ghostty
    // raise the exact tab itself. Instant and precise for scriptable windows.
    if !title.isEmpty,
       NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.mitchellh.ghostty" {
        let g = focusViaGhosttyAppleScript(pid: pid, title: title) { onscreenIds().contains(Int(cgid)) }
        if g.hasPrefix("ok") { return g }
        // AppleScript sees every scriptable Ghostty window/tab; if the title
        // isn't there the target lives on another Space and is unreachable by
        // any strategy (menu/scan/cycle all no-op for this app) — fail fast.
        if g == "not-found" { return "failed: ghostty-other-space-unreachable" }
        misses.append(g)
    }

    let appVisible = hasOnscreenWindow(pid)

    // Strategy B/C/D state machine — every strategy verifies its landing;
    // we only give up after all of them had a chance.

    // B1: menu click WITHOUT activation first (avoids the "wrong window
    // flash" of jumping to the app's most-recent window).
    if !title.isEmpty && appVisible && focusViaWindowMenu(pid: pid, title: title).hasPrefix("ok") {
        if waitLanded(2500) { return "ok-menu" }
        misses.append("menu-noact")
    }

    // B2: with activation (required when all windows are on other Spaces).
    activateApp(pid)
    if !title.isEmpty && focusViaWindowMenu(pid: pid, title: title).hasPrefix("ok") {
        if waitLanded(2500) { return "ok-menu-activated" }
        misses.append("menu-act")
        // System Events races are real: one settle-delayed retry.
        usleep(250_000)
        if focusViaWindowMenu(pid: pid, title: title).hasPrefix("ok"), waitLanded(2000) {
            return "ok-menu-retry"
        }
    }

    // C: scan Window-menu entries clicking each until target lands (works
    // even with empty titles — verification is cgid-based).
    if memoHit(Int(pid), "scan-dead", ttl: 120) {
        misses.append("scan-dead(cached)")
    } else {
        let scan = focusByMenuScan(pid: pid, cgid: cgid)
        if scan.hasPrefix("ok") { return scan }
        misses.append(scan)
        if scan == "scan-failed" { memoSet(Int(pid), "scan-dead") }
    }

    // D: native-tab cycle (Ghostty-style apps).
    if memoHit(Int(pid), "tabs-dead", ttl: 300) {
        misses.append("tabs-dead(cached)")
    } else {
        let tab = focusViaTabCycle(pid: pid, cgid: cgid)
        if tab.hasPrefix("ok") { return tab }
        misses.append(tab)
        if tab == "tab-cycle-stuck" || tab == "no-next-tab-item" || tab == "tab-cycle-failed" {
            memoSet(Int(pid), "tabs-dead")
        }
    }

    return "failed: " + misses.joined(separator: ",")
}

func focusViaGhosttyAppleScript(pid: pid_t, title: String, landedCheck: () -> Bool) -> String {
    let script = """
    on run argv
      set wtitle to item 1 of argv
      tell application "Ghostty"
        repeat with w in windows
          repeat with t in tabs of w
            try
              if (name of t) is wtitle then
                set selected of t to true
                return "ok"
              end if
            end try
          end repeat
        end repeat
        return "not-found"
      end tell
    end run
    """
    // first-ever call may block on the macOS Automation consent dialog
    let r = runOsa(script, [title], timeoutSeconds: 6)
    guard r == "ok" else { return r ?? "osa-error" }
    var landedNow = false
    let deadline = Date().addingTimeInterval(1.2)
    while Date() < deadline {
        if landedCheck() { landedNow = true; break }
        usleep(100_000)
    }
    return landedNow ? "ok-ghostty-as" : "ghostty-as-unverified"
}

private let menuVerbJunk = [
    "minimize", "zoom", "bring all to front", "reduce", "fill", "center",
    "réduire", "zoomer", "ramener au premier plan", "organiser au premier plan",
    "déplacer et redimensionner", "occuper toute", "supprimer la fenêtre",
    "minimiser toutes", "réduire/agrandir", "move & resize", "remove window",
    "toggle full screen", "show previous tab", "show next tab",
    "move tab to new window", "merge all windows", "zoom split",
    "select previous split", "select next split", "select split",
    "resize split", "return to default size", "float on top",
    "use as default", "show/hide all terminals", "full screen tile",
    "tile window", "move window",
]

/// Returns the clickable window-entry titles of the app's native Window menu.
func windowMenuEntries(pid: pid_t) -> [String] {
    let script = """
    on run argv
      set pid to (item 1 of argv) as integer
      tell application "System Events"
        set p to first application process whose unix id is pid
        set menuNames to {"Window", "Fenêtre", "Ventana", "Fenster", "Finestra", "Janela"}
        set targetMenu to missing value
        repeat with mbi in menu bar items of menu bar 1 of p
          try
            if (name of mbi as text) is in menuNames then set targetMenu to contents of mbi
          end try
        end repeat
        if targetMenu is missing value then return ""
        set out to {}
        repeat with it_ in menu items of menu 1 of targetMenu
          try
            set nm to name of it_ as text
            if nm is not missing value and nm is not "" then set out to out & {nm}
          end try
        end repeat
        set AppleScript's text item delimiters to linefeed
        return out as text
      end tell
    end run
    """
    guard let out = runOsa(script, [String(pid)]) else { return [] }
    return out.isEmpty ? [] : out.components(separatedBy: .newlines).map {
        $0.trimmingCharacters(in: .whitespaces)
    }.filter { !$0.isEmpty }
}

func runOsa(_ script: String, _ args: [String], timeoutSeconds: Double = 0) -> String? {
    let pr = Process()
    pr.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    pr.arguments = ["-e", script] + args
    let pipe = Pipe()
    pr.standardOutput = pipe
    pr.standardError = FileHandle.nullDevice
    do { try pr.run() } catch { return nil }
    if timeoutSeconds > 0 {
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while pr.isRunning && Date() < deadline { usleep(50_000) }
        if pr.isRunning { pr.terminate(); return nil }
    } else {
        pr.waitUntilExit()
    }
    guard pr.terminationStatus == 0 else { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
}

func focusByMenuScan(pid: pid_t, cgid: CGWindowID) -> String {
    let entries = Array(windowMenuEntries(pid: pid).filter { name in
        let lower = name.lowercased()
        if name.hasSuffix("…") || name.hasSuffix("...") { return false }
        return !menuVerbJunk.contains(where: { lower.contains($0) })
    }.prefix(6))
    let clickScript = """
    on run argv
      set pid to (item 1 of argv) as integer
      set wtitle to item 2 of argv
      tell application "System Events"
        set p to first application process whose unix id is pid
        set menuNames to {"Window", "Fen\u{00EA}tre", "Ventana", "Fenster", "Finestra", "Janela"}
        set targetMenu to missing value
        repeat with mbi in menu bar items of menu bar 1 of p
          try
            if (name of mbi as text) is in menuNames then set targetMenu to contents of mbi
          end try
        end repeat
        if targetMenu is missing value then return "no-window-menu"
        try
          click (first menu item of menu 1 of targetMenu whose name is wtitle)
          return "ok"
        end try
        return "miss"
      end tell
    end run
    """
    for name in entries {
        let r = runOsa(clickScript, [String(pid), name]) ?? "err"
        usleep(400_000)
        if r == "ok", onscreenIds().contains(Int(cgid)) { return "ok-menu-scan" }
    }
    return "scan-failed"
}

func main() {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let cmd = args.first else {
        fputs("usage: helper list | focus <pid> <cgid> <title>\n", stderr)
        exit(2)
    }
    switch cmd {
    case "list":
        var wins = cgWindows()
        // Enrich titles via Accessibility (works without Screen Recording):
        // AX exposes real titles for current-Space windows (+ Electron apps
        // after the AXManualAccessibility poke).
        var axCache: [Int: [AxWin]] = [:]
        for i in wins.indices where wins[i].title.isEmpty {
            let pid = wins[i].pid
            let axWins: [AxWin]
            if let cached = axCache[pid] { axWins = cached }
            else { axWins = axWindows(pid: pid_t(pid)); axCache[pid] = axWins }
            if let m = axWins.first(where: { $0.cgid == CGWindowID(wins[i].cgid) }), !m.title.isEmpty {
                wins[i] = Win(owner: wins[i].owner, pid: wins[i].pid, cgid: wins[i].cgid,
                              title: m.title, x: wins[i].x, y: wins[i].y, w: wins[i].w, h: wins[i].h,
                              onscreen: wins[i].onscreen, path: wins[i].path)
            }
        }
        if wins.contains(where: { $0.title.isEmpty }) {
            // helper binary has its own TCC identity (does NOT inherit
            // Raycast's grant): trigger the system prompt so a dedicated
            // toggle shows up in the Screen Recording pane.
            CGRequestScreenCaptureAccess()
        }
        let payload: [String: Any] = [
            "windows": wins.map { w in
                ["owner": w.owner, "pid": w.pid, "cgid": w.cgid, "title": w.title,
                 "x": w.x, "y": w.y, "w": w.w, "h": w.h, "onscreen": w.onscreen, "path": w.path]
            },
            "untitled": wins.filter { $0.title.isEmpty }.count,
            "total": wins.count,
        ]
        let data = try! JSONSerialization.data(withJSONObject: payload)
        FileHandle.standardOutput.write(data)
        // TCC diagnostics: who are we, do we hold screen-recording?
        let diag: [String: Any] = [
            "pid": ProcessInfo.processInfo.processIdentifier,
            "ppid": Int(getppid()),
            "preflightScreenCapture": CGPreflightScreenCaptureAccess(),
            "isBundle": Bundle.main.bundlePath != "/",
        ]
        if let d = try? JSONSerialization.data(withJSONObject: diag) {
            try? d.write(to: URL(fileURLWithPath: "/tmp/ws-diag.json"))
        }

    case "focus":
        guard args.count >= 3, let pid = Int32(args[1]), let cgid = CGWindowID(args[2]) else {
            fputs("focus requires <pid> <cgid> <title>\n", stderr)
            exit(2)
        }
        print(focusWindow(pid: pid, cgid: cgid, title: args[3]))

    default:
        fputs("unknown command \(cmd)\n", stderr)
        exit(2)
    }
}

main()
