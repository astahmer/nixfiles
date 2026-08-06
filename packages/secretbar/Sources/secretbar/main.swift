import AppKit
import Foundation
import SwiftUI

// SecretBar: a menu bar launcher for the deployed `secret` CLI. It spawns the
// wrapper (session injection, keychain, daemon) and adds UI-native features
// the CLI cannot do: cross-project search, one-click copy, Touch ID unlock,
// proactive health, and recent re-copy. No values are ever displayed.

// MARK: - Spawn helpers

struct RunResult {
    var status: Int32
    var stdout: String
    var stderr: String
}

func secretBin() -> String {
    if let override = ProcessInfo.processInfo.environment["SECRET_BIN"], !override.isEmpty {
        return override
    }
    let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
    let candidates = [
        "\(home)/.nix-profile/bin/secret",
        "/usr/local/bin/secret",
        "/opt/homebrew/bin/secret",
    ]
    for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
        return candidate
    }
    return "secret"
}

func runSecret(
    _ args: [String],
    cwd: String? = nil,
    input: String? = nil,
    timeout: TimeInterval = 45
) -> RunResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: secretBin())
    process.arguments = args
    if let cwd {
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
    }
    let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
    var env = ProcessInfo.processInfo.environment
    env["HOME"] = home
    env["PATH"] = "\(home)/.nix-profile/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    process.environment = env

    let out = Pipe()
    let err = Pipe()
    process.standardOutput = out
    process.standardError = err
    if let input {
        let inPipe = Pipe()
        process.standardInput = inPipe
        DispatchQueue.global().async {
            try? inPipe.fileHandleForWriting.write(contentsOf: Data((input + "\n").utf8))
            try? inPipe.fileHandleForWriting.close()
        }
    } else {
        process.standardInput = FileHandle.nullDevice
    }

    do {
        try process.run()
    } catch {
        return RunResult(status: 127, stdout: "", stderr: "\(error)")
    }
    let semaphore = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
        process.waitUntilExit()
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + timeout) == .timedOut {
        process.terminate()
        return RunResult(status: 124, stdout: "", stderr: "timed out")
    }
    let outData = (try? out.fileHandleForReading.readToEnd()) ?? Data()
    let errData = (try? err.fileHandleForReading.readToEnd()) ?? Data()
    return RunResult(
        status: process.terminationStatus,
        stdout: String(data: outData, encoding: .utf8) ?? "",
        stderr: String(data: errData, encoding: .utf8) ?? ""
    )
}

// MARK: - Model

struct Project: Identifiable, Hashable {
    let name: String
    let dir: String
    var id: String { dir }
}

struct AliasEntry: Identifiable {
    let alias: String
    let project: String
    let configPath: String
    let cwd: String
    var id: String { "\(project):\(alias)" }
}

enum VaultState {
    case unknown
    case unlocked
    case locked
    case unauthenticated
    case error
}

@MainActor
final class SecretBarModel: ObservableObject {
    static let shared = SecretBarModel()

    @Published var state: VaultState = .unknown
    @Published var projects: [Project] = []
    @Published var entries: [AliasEntry] = []
    @Published var recent: [AliasEntry] = []
    @Published var problems: [String: Int] = [:]
    @Published var sessionCreated: String?
    @Published var busy = false
    @Published var flash: String?
    @Published var lastError: String?
    @Published var password = ""

    private var statusTimer: Timer?
    private var healthTimer: Timer?
    private var lastHealthRun: Date?
    private var flashTask: Task<Void, Never>?

    func start() {
        guard statusTimer == nil else { return }
        refreshEverything()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let strongSelf = self else { return }
            Task { @MainActor in strongSelf.refreshStatus() }
        }
        healthTimer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
            guard let strongSelf = self else { return }
            Task { @MainActor in strongSelf.refreshHealth() }
        }
    }

    func refreshEverything() {
        refreshStatus()
        refreshIndex()
        refreshRecent()
        refreshSessionAge()
        refreshHealth()
    }

    func refreshStatus() {
        let result = runSecret(["status", "--check"])
        Task { @MainActor in
            if result.status == 0 {
                state = .unlocked
            } else if result.stdout.contains("unauthenticated") {
                state = .unauthenticated
            } else if result.stdout.contains("locked") {
                state = .locked
            } else {
                state = .error
            }
        }
    }

    func refreshIndex() {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let devDir = "\(home)/dev"
        var found: [Project] = []
        if let items = try? FileManager.default.contentsOfDirectory(atPath: devDir) {
            for name in items.sorted() where !name.hasPrefix(".") {
                let dir = "\(devDir)/\(name)"
                var isDir: ObjCBool = false
                guard FileManager.default.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue else {
                    continue
                }
                if FileManager.default.fileExists(atPath: "\(dir)/.secret.json") {
                    found.append(Project(name: name, dir: dir))
                }
            }
        }
        found.append(Project(name: "global", dir: home))
        projects = found

        var all: [AliasEntry] = []
        for project in found {
            let configPath = project.name == "global"
                ? "\(home)/.config/secret/config.json"
                : "\(project.dir)/.secret.json"
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: configPath)),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let secrets = json["secrets"] as? [String: Any]
            else { continue }
            for (alias, definition) in secrets.sorted(by: { $0.key < $1.key }) {
                guard let definition = definition as? [String: Any],
                      let item = definition["item"] as? String, !item.isEmpty
                else { continue }
                all.append(AliasEntry(
                    alias: alias,
                    project: project.name,
                    configPath: configPath,
                    cwd: project.dir
                ))
            }
        }
        entries = all
        refreshRecent()
    }

    func refreshRecent() {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let historyPath = "\(home)/.config/secret/history.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: historyPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return }
        var seen: [String: String] = [:]
        for entry in json {
            guard let cmd = entry["cmd"] as? String, cmd == "get" || cmd == "set",
                  let alias = entry["target"] as? String,
                  let at = entry["at"] as? String
            else { continue }
            if let previous = seen[alias], previous >= at { continue }
            seen[alias] = at
        }
        let byAlias = seen.sorted { $0.value > $1.value }.prefix(8)
        let byProject = Dictionary(grouping: entries) { $0.alias }
        recent = byAlias.compactMap { alias, _ in
            byProject[alias]?.first
        }
    }

    func refreshHealth() {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let devDir = "\(home)/dev"
        var projectsToCheck: [Project] = []
        if let items = try? FileManager.default.contentsOfDirectory(atPath: devDir) {
            for name in items.sorted() where !name.hasPrefix(".") {
                let dir = "\(devDir)/\(name)"
                if FileManager.default.fileExists(atPath: "\(dir)/.secret.json") {
                    projectsToCheck.append(Project(name: name, dir: dir))
                    if projectsToCheck.count >= 15 { break }
                }
            }
        }
        let checked = projectsToCheck
        Task.detached(priority: .utility) {
            var result: [String: Int] = [:]
            for project in checked {
                let run = runSecret(["doctor"], cwd: project.dir, timeout: 45)
                let stderr = run.stderr
                if stderr.contains("aliases ok"), let problems = Self.parseProblems(stderr) {
                    result[project.name] = problems
                }
                // locked/unauthenticated output is a state, not a health issue
            }
            let snapshot = result
            await MainActor.run {
                self.problems = snapshot
                self.lastHealthRun = Date()
            }
        }
    }

    nonisolated static func parseProblems(_ stderr: String) -> Int? {
        guard let range = stderr.range(of: " problem(s)") else { return nil }
        let prefix = stderr[..<range.lowerBound]
        guard let comma = prefix.lastIndex(of: ",") else { return nil }
        let number = prefix[prefix.index(after: comma)...].trimmingCharacters(in: .whitespaces)
        return Int(number)
    }

    func refreshSessionAge() {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let security = "/usr/bin/security"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: security)
        process.arguments = ["find-generic-password", "-a", "bitwarden-session", "-s", "secret-cli"]
        process.environment = ["HOME": home, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
        let out = Pipe()
        process.standardOutput = out
        process.standardError = Pipe()
        do {
            try process.run()
        } catch {
            return
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let data = try? out.fileHandleForReading.readToEnd(),
              let text = String(data: data, encoding: .utf8)
        else { return }
        // "created" attribute: `"cdat"<blob>=...` or a "created:" line; parse
        // the first ISO-ish date found in the metadata.
        let pattern = #"20\d\d-\d\d-\d\d[ T]\d\d:\d\d:\d\d"#
        guard let match = text.range(of: pattern, options: .regularExpression) else { return }
        let raw = String(text[match]).replacingOccurrences(of: "T", with: " ")
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        guard let date = formatter.date(from: raw) else { return }
        let display = DateFormatter()
        display.dateFormat = "yyyy-MM-dd HH:mm"
        Task { @MainActor in
            self.sessionCreated = display.string(from: date)
        }
    }

    func copy(_ entry: AliasEntry) {
        setBusy(true)
        let result = runSecret(["get", "--config", entry.configPath, entry.alias], cwd: entry.cwd)
        setBusy(false)
        guard result.status == 0 else {
            flashError("get \(entry.alias): \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
            return
        }
        let value = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            flashError("get \(entry.alias) returned nothing")
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(value, forType: .string)
        flash("copied \(entry.alias)")
    }

    func openSource(_ entry: AliasEntry) {
        setBusy(true)
        let result = runSecret(["source", "--config", entry.configPath, entry.alias, "--open"], cwd: entry.cwd)
        setBusy(false)
        if result.status == 0 {
            flash("opened source for \(entry.alias)")
        } else {
            flashError("no source for \(entry.alias): \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
    }

    func rotate(_ entry: AliasEntry) {
        setBusy(true)
        let result = runSecret(["rotate", "--config", entry.configPath, entry.alias, "--force"], cwd: entry.cwd, timeout: 60)
        setBusy(false)
        if result.status == 0 {
            flash("rotated \(entry.alias) — new value copied")
        } else {
            flashError("rotate \(entry.alias): \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
    }

    func unlockWithTouchID() {
        setBusy(true)
        let result = runSecret(["unlock", "--helper"], timeout: 60)
        setBusy(false)
        if result.status == 0 {
            flash("unlocked with Touch ID")
            refreshEverything()
        } else {
            flashError(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    func unlockWithPassword() {
        let secret = password
        password = ""
        guard !secret.isEmpty else { return }
        setBusy(true)
        let result = runSecret(["unlock", "--store"], input: secret, timeout: 60)
        setBusy(false)
        if result.status == 0 {
            flash("unlocked; session stored")
            refreshEverything()
        } else {
            flashError(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    func lock() {
        setBusy(true)
        _ = runSecret(["lock"])
        setBusy(false)
        state = .locked
        flash("vault locked")
    }

    private func setBusy(_ value: Bool) {
        busy = value
    }

    func flash(_ message: String) {
        flash = message
        flashTask?.cancel()
        flashTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled {
                flash = nil
            }
        }
    }

    func flashError(_ message: String) {
        lastError = message
        flash(message)
    }
}

// MARK: - Views

struct StatusDot: View {
    let state: VaultState

    var color: Color {
        switch state {
        case .unlocked: return .green
        case .locked: return .orange
        case .unauthenticated: return .red
        case .error, .unknown: return .gray
        }
    }

    var body: some View {
        Circle().fill(color).frame(width: 11, height: 11)
    }
}

// Menu bar label: SF Symbols render reliably as template images (a plain
// shape can show up empty), and the shape itself conveys the state.
struct StatusIcon: View {
    let state: VaultState

    var symbol: String {
        switch state {
        case .unlocked: return "lock.open.fill"
        case .locked: return "lock.fill"
        case .unauthenticated: return "exclamationmark.triangle.fill"
        case .error, .unknown: return "circle.dashed"
        }
    }

    var body: some View {
        Image(systemName: symbol)
    }
}

struct SecretBarView: View {
    @EnvironmentObject var model: SecretBarModel
    @State private var query = ""
    @State private var rotating: AliasEntry?
    @State private var showPassword = false

    var filtered: [AliasEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return model.entries }
        return model.entries.filter {
            $0.alias.lowercased().contains(needle) || $0.project.lowercased().contains(needle)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Divider()
            if model.state != .unlocked {
                unlockSection
                Divider()
            }
            searchField
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                recentSection
            }
            aliasList
            Divider()
            footer
        }
        .padding(10)
        .frame(width: 380, height: 460)
        .onAppear { model.start() }
        .confirmationDialog(
            "Rotate \(rotating?.alias ?? "")?",
            isPresented: Binding(get: { rotating != nil }, set: { if !$0 { rotating = nil } }),
            titleVisibility: .visible
        ) {
            Button("Rotate and copy new value", role: .destructive) {
                if let rotating {
                    model.rotate(rotating)
                }
                rotating = nil
            }
            Button("Cancel", role: .cancel) { rotating = nil }
        } message: {
            Text("Generates a new password in Bitwarden and copies it to the clipboard.")
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            StatusDot(state: model.state)
            Text(stateLabel)
                .font(.headline)
            Spacer()
            if model.busy {
                ProgressView().controlSize(.small)
            }
            if model.state == .unlocked {
                Button {
                    model.lock()
                } label: {
                    Image(systemName: "lock")
                }
                .help("Lock the vault")
                .disabled(model.busy)
            }
        }
    }

    private var stateLabel: String {
        switch model.state {
        case .unknown: return "secret"
        case .unlocked: return "unlocked"
        case .locked: return "locked"
        case .unauthenticated: return "not logged in"
        case .error: return "error"
        }
    }

    private var unlockSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !showPassword {
                HStack {
                    Button {
                        model.unlockWithTouchID()
                    } label: {
                        Label("Unlock with Touch ID", systemImage: "touchid")
                    }
                    .disabled(model.busy)
                    Button("Master password…") {
                        showPassword = true
                    }
                }
            } else {
                HStack {
                    SecureField("Master password", text: $model.password)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { model.unlockWithPassword() }
                    Button("Unlock") { model.unlockWithPassword() }
                        .disabled(model.busy || model.password.isEmpty)
                }
            }
        }
    }

    private var searchField: some View {
        TextField("Search aliases across projects…", text: $query)
            .textFieldStyle(.roundedBorder)
    }

    private var recentSection: some View {
        Group {
            if !model.recent.isEmpty {
                Text("RECENT")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach(model.recent) { entry in
                    entryRow(entry)
                }
                Divider()
            }
        }
    }

    private var aliasList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                if filtered.isEmpty {
                    Text(model.entries.isEmpty ? "No projects with .secret.json found in ~/dev" : "No matches")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 20)
                        .frame(maxWidth: .infinity)
                } else {
                    ForEach(filtered) { entry in
                        entryRow(entry)
                    }
                }
            }
        }
    }

    private func entryRow(_ entry: AliasEntry) -> some View {
        HStack(spacing: 8) {
            Button {
                model.copy(entry)
            } label: {
                HStack {
                    Text(entry.alias)
                        .font(.system(.body, design: .monospaced))
                        .lineLimit(1)
                    Spacer()
                    Text(entry.project)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Image(systemName: "doc.on.doc")
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Open source URL") { model.openSource(entry) }
                Button("Rotate and copy new value") { rotating = entry }
            }
        }
        .padding(.vertical, 2)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let sessionCreated = model.sessionCreated {
                Text("Stored session from \(sessionCreated)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            let health = model.problems.filter { $0.value > 0 }
            if !health.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text(health.map { "\($0.key) (\($0.value))" }.joined(separator: ", "))
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
            }
            if let flash = model.flash {
                Text(flash)
                    .font(.caption)
                    .foregroundStyle(model.lastError == flash ? Color.red : Color.secondary)
                    .lineLimit(2)
            }
            Button("Quit SecretBar") {
                NSApplication.shared.terminate(nil)
            }
            .font(.caption2)
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
    }
}

@MainActor
final class SecretBarAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        SecretBarModel.shared.start()
    }
}

@main
struct SecretBarApp: App {
    @NSApplicationDelegateAdaptor(SecretBarAppDelegate.self) private var appDelegate
    @StateObject private var model = SecretBarModel.shared

    var body: some Scene {
        MenuBarExtra {
            SecretBarView()
                .environmentObject(model)
        } label: {
            StatusIcon(state: model.state)
        }
        .menuBarExtraStyle(.window)
    }
}
