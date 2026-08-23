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
        ? [.excludeDesktopElements]
        : [.optionAll, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
    var out: [Win] = []
    for w in list {
        guard w["kCGWindowLayer"] as? Int == 0 else { continue }
        let owner = w["kCGWindowOwnerName"] as? String ?? ""
        if owner.isEmpty || junkOwners.contains(owner) { continue }
        if let pid = w["kCGWindowOwnerPID"] as? Int,
           NSRunningApplication(processIdentifier: pid_t(pid))?.activationPolicy != .regular {
            continue // skip menu-bar agents / background helpers
        }
        guard let b = w["kCGWindowBounds"] as? [String: CGFloat] else { continue }
        let bw = b["Width"] ?? 0, bh = b["Height"] ?? 0
        if bw < 150 || bh < 150 { continue }
        if (w["kCGWindowAlpha"] as? Double).map({ $0 <= 0.01 }) == true { continue }
        out.append(Win(
            owner: owner,
            pid: w["kCGWindowOwnerPID"] as? Int ?? -1,
            cgid: w["kCGWindowNumber"] as? Int ?? -1,
            title: w["kCGWindowTitle"] as? String ?? "",
            x: b["X"] ?? 0, y: b["Y"] ?? 0, w: bw, h: bh,
            onscreen: w["kCGWindowIsOnscreen"] as? Bool ?? false,
            path: NSRunningApplication(processIdentifier: pid_t(w["kCGWindowOwnerPID"] as? Int ?? -1))?.bundleURL?.path ?? ""
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

func frontmostWindowCgid(pid: pid_t) -> Int? {
    // on-screen list comes back front-to-back
    for w in cgWindows(onlyOnscreen: true) where w.pid == pid {
        return w.cgid
    }
    return nil
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
    let pr = Process()
    pr.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    pr.arguments = ["-e", script, String(pid), title]
    let pipe = Pipe()
    pr.standardOutput = pipe
    pr.standardError = FileHandle.nullDevice
    do { try pr.run() } catch { return "osascript-error" }
    pr.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "osascript-error"
}

func activateApp(_ pid: pid_t) {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return }
    if #available(macOS 14.0, *) {
        app.activate()
    } else {
        app.activate(options: [.activateIgnoringOtherApps])
    }
    usleep(350_000)
}

func focusWindow(pid: pid_t, cgid: CGWindowID, title: String) -> String {
    let axWins = axWindows(pid: pid)

    // Path 1: direct AX raise (same Space, normal cross-Space windows, minimized)
    let match =
        axWins.first(where: { $0.cgid == cgid })
        ?? axWins.first(where: { !title.isEmpty && $0.title == title })
    if let m = match {
        if m.minimized {
            AXUIElementSetAttributeValue(m.el, "AXMinimized" as CFString, kCFBooleanFalse)
            usleep(100_000)
        }
        activateApp(pid)
        AXUIElementPerformAction(m.el, kAXRaiseAction as CFString)
        usleep(150_000)
        AXUIElementPerformAction(m.el, kAXRaiseAction as CFString)
        return "ok"
    }

    // Path 2: fullscreen / other-Space windows invisible to AX -> Window menu.
    // The app must be active first or macOS may not follow the clicked entry
    // into its fullscreen Space.
    guard !title.isEmpty else { return "no-title-for-menu" }
    activateApp(pid)
    return focusViaWindowMenu(pid: pid, title: title)
}

func main() {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let cmd = args.first else {
        fputs("usage: helper list | focus <pid> <cgid> <title>\n", stderr)
        exit(2)
    }
    switch cmd {
    case "list":
        let wins = cgWindows()
        let payload: [String: Any] = [
            "windows": wins.map { w in
                ["owner": w.owner, "pid": w.pid, "cgid": w.cgid, "title": w.title,
                 "x": w.x, "y": w.y, "w": w.w, "h": w.h, "onscreen": w.onscreen, "path": w.path]
            },
            "titlesEmpty": wins.allSatisfy { $0.title.isEmpty },
        ]
        let data = try! JSONSerialization.data(withJSONObject: payload)
        FileHandle.standardOutput.write(data)

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
