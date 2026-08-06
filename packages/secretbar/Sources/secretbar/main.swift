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
    var isGlobal: Bool { name == "global" }
    var configPath: String {
        isGlobal ? "\(dir)/.config/secret/config.json" : "\(dir)/.secret.json"
    }
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
        // Let the CLI write directly to pbcopy so the menu-bar process never
        // receives the secret value in stdout.
        let result = runSecret(["get", "--copy", "--config", entry.configPath, entry.alias], cwd: entry.cwd)
        setBusy(false)
        guard result.status == 0 else {
            flashError("get \(entry.alias): \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
            return
        }
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

    func create(
        alias: String,
        project: Project,
        value: String,
        itemName: String,
        source: String,
        notes: String
    ) -> Bool {
        let cleanAlias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanAlias.isEmpty else {
            flashError("enter an alias")
            return false
        }
        guard !cleanValue.isEmpty else {
            flashError("enter a value")
            return false
        }
        var args = ["set", cleanAlias]
        if project.name == "global" {
            args.append("--global")
        } else {
            args += ["--config", project.configPath]
        }
        if !itemName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--name", itemName]
        }
        if !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--source", source]
        }
        if !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--notes", notes]
        }
        setBusy(true)
        let result = runSecret(args, cwd: project.dir, input: cleanValue, timeout: 60)
        setBusy(false)
        guard result.status == 0 else {
            flashError("create \(cleanAlias): \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
            return false
        }
        flash("created \(cleanAlias) in \(project.name == "global" ? "global" : project.name)")
        refreshEverything()
        return true
    }

    func edit(
        _ entry: AliasEntry,
        itemName: String,
        value: String,
        source: String?,
        notes: String?,
        clearSource: Bool,
        clearNotes: Bool
    ) -> Bool {
        let cleanName = itemName.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanSource = source?.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanNotes = notes?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasChanges = !cleanName.isEmpty || !cleanValue.isEmpty || clearSource || cleanSource?.isEmpty == false || clearNotes || cleanNotes?.isEmpty == false
        guard hasChanges else {
            flashError("make a change first")
            return false
        }
        var args = ["edit", entry.alias, "--config", entry.configPath, "--force"]
        if !cleanName.isEmpty { args += ["--name", itemName] }
        if !cleanValue.isEmpty { args += ["--field", "password", "--value-stdin"] }
        if clearSource || cleanSource?.isEmpty == false { args += ["--source", clearSource ? "" : (source ?? "")] }
        if clearNotes || cleanNotes?.isEmpty == false { args += ["--notes", clearNotes ? "" : (notes ?? "")] }
        setBusy(true)
        let result = runSecret(
            args,
            cwd: entry.cwd,
            input: cleanValue.isEmpty ? nil : cleanValue,
            timeout: 60
        )
        setBusy(false)
        guard result.status == 0 else {
            flashError("edit \(entry.alias): \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))")
            return false
        }
        flash("updated \(entry.alias)")
        refreshEverything()
        return true
    }

    func unlockWithTouchID() {
        setBusy(true)
        let result = runSecret(["unlock", "--helper"], timeout: 60)
        let verified = result.status == 0 && runSecret(["status", "--check"], timeout: 30).status == 0
        setBusy(false)
        if verified {
            flash("unlocked with Touch ID")
            refreshEverything()
        } else {
            let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            flashError(detail.isEmpty ? "Touch ID authenticated, but the vault is still locked" : detail)
        }
    }

    func unlockWithPassword() {
        let secret = password
        password = ""
        guard !secret.isEmpty else { return }
        setBusy(true)
        let result = runSecret(["unlock", "--store"], input: secret, timeout: 60)
        let verified = result.status == 0 && runSecret(["status", "--check"], timeout: 30).status == 0
        setBusy(false)
        if verified {
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

struct LegacySecretBarView: View {
    @EnvironmentObject var model: SecretBarModel
    @State private var query = ""
    @State private var copying: AliasEntry?
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
        .confirmationDialog(
            "Copy \(copying?.alias ?? "")?",
            isPresented: Binding(get: { copying != nil }, set: { if !$0 { copying = nil } }),
            titleVisibility: .visible
        ) {
            Button("Copy value") {
                if let copying { model.copy(copying) }
                copying = nil
            }
            Button("Cancel", role: .cancel) { copying = nil }
        } message: {
            Text("This puts the secret value on the clipboard. It may be available to other apps until the clipboard is replaced.")
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
                copying = entry
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

enum SecretBarTab: String, CaseIterable {
    case create
    case secrets
    case settings

    var title: String {
        switch self {
        case .create: return "Create"
        case .secrets: return "My Secrets"
        case .settings: return "Settings"
        }
    }
}

struct SecretEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: SecretBarModel
    let entry: AliasEntry
    @State private var itemName = ""
    @State private var value = ""
    @State private var source = ""
    @State private var notes = ""
    @State private var clearSource = false
    @State private var clearNotes = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Edit \(entry.alias)")
                .font(.headline)
            Text("\(entry.project) · leave a field blank to keep it unchanged")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Bitwarden item name", text: $itemName)
                .textFieldStyle(.roundedBorder)
            SecureField("New value (optional)", text: $value)
                .textFieldStyle(.roundedBorder)
            TextField("Source URL (optional)", text: $source)
                .textFieldStyle(.roundedBorder)
            Toggle("Clear source", isOn: $clearSource)
                .toggleStyle(.checkbox)
            TextEditor(text: $notes)
                .font(.body)
                .frame(minHeight: 64, maxHeight: 100)
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.secondary.opacity(0.25)))
            Toggle("Clear notes", isOn: $clearNotes)
                .toggleStyle(.checkbox)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save changes") {
                    let saved = model.edit(
                        entry,
                        itemName: itemName,
                        value: value,
                        source: source,
                        notes: notes,
                        clearSource: clearSource,
                        clearNotes: clearNotes
                    )
                    if saved { dismiss() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.busy)
            }
        }
        .padding(16)
        .frame(width: 420, height: 420)
    }
}

struct SecretBarView: View {
    @EnvironmentObject var model: SecretBarModel
    @State private var tab: SecretBarTab = .secrets
    @State private var query = ""
    @State private var copying: AliasEntry?
    @State private var rotating: AliasEntry?
    @State private var editing: AliasEntry?
    @State private var showPassword = false
    @State private var selectedProjectID = ""
    @State private var createAlias = ""
    @State private var createItemName = ""
    @State private var createValue = ""
    @State private var createSource = ""
    @State private var createNotes = ""

    private var filtered: [AliasEntry] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return model.entries }
        return model.entries.filter {
            $0.alias.lowercased().contains(needle) || $0.project.lowercased().contains(needle)
        }
    }

    private var selectedProject: Project? {
        model.projects.first(where: { $0.id == selectedProjectID }) ?? model.projects.first(where: { $0.isGlobal })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Divider()
            Group {
                switch tab {
                case .create: createTab
                case .secrets: secretsTab
                case .settings: settingsTab
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Picker("Section", selection: $tab) {
                ForEach(SecretBarTab.allCases, id: \.self) { section in
                    Text(section.title).tag(section)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            footer
        }
        .padding(10)
        .frame(width: 430, height: 610)
        .onAppear {
            model.start()
            if selectedProjectID.isEmpty {
                selectedProjectID = model.projects.first(where: { $0.isGlobal })?.id ?? model.projects.first?.id ?? ""
            }
        }
        .sheet(item: $editing) { entry in
            SecretEditSheet(model: model, entry: entry)
        }
        .confirmationDialog(
            "Rotate \(rotating?.alias ?? "")?",
            isPresented: Binding(get: { rotating != nil }, set: { if !$0 { rotating = nil } }),
            titleVisibility: .visible
        ) {
            Button("Rotate and copy new value", role: .destructive) {
                if let rotating { model.rotate(rotating) }
                rotating = nil
            }
            Button("Cancel", role: .cancel) { rotating = nil }
        } message: {
            Text("Generates a new password in Bitwarden and copies it to the clipboard.")
        }
        .confirmationDialog(
            "Copy \(copying?.alias ?? "")?",
            isPresented: Binding(get: { copying != nil }, set: { if !$0 { copying = nil } }),
            titleVisibility: .visible
        ) {
            Button("Copy value") {
                if let copying { model.copy(copying) }
                copying = nil
            }
            Button("Cancel", role: .cancel) { copying = nil }
        } message: {
            Text("This puts the secret value on the clipboard. It may be available to other apps until the clipboard is replaced.")
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            StatusDot(state: model.state)
            Text(stateLabel).font(.headline)
            Spacer()
            if model.busy { ProgressView().controlSize(.small) }
            Button {
                model.refreshEverything()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .help("Refresh secrets")
            .disabled(model.busy)
            if model.state == .unlocked {
                Button { model.lock() } label: { Image(systemName: "lock") }
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

    private var createTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Create a secret").font(.title3.weight(.semibold))
            Text("Choose where its alias belongs; the value is sent through stdin and never put in the process arguments.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Picker("Scope", selection: $selectedProjectID) {
                ForEach(model.projects) { project in
                    Text(project.isGlobal ? "Global" : project.name).tag(project.id)
                }
            }
            TextField("Alias", text: $createAlias).textFieldStyle(.roundedBorder)
            TextField("Bitwarden item name (optional)", text: $createItemName).textFieldStyle(.roundedBorder)
            SecureField("Value", text: $createValue).textFieldStyle(.roundedBorder)
            TextField("Source URL (optional)", text: $createSource).textFieldStyle(.roundedBorder)
            TextEditor(text: $createNotes)
                .font(.body)
                .frame(minHeight: 72, maxHeight: 110)
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.secondary.opacity(0.25)))
            HStack {
                Text("Notes (optional)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Create") {
                    guard let project = selectedProject else {
                        model.flashError("no project scope available")
                        return
                    }
                    if model.create(
                        alias: createAlias,
                        project: project,
                        value: createValue,
                        itemName: createItemName,
                        source: createSource,
                        notes: createNotes
                    ) {
                        createAlias = ""
                        createItemName = ""
                        createValue = ""
                        createSource = ""
                        createNotes = ""
                        tab = .secrets
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.busy || model.state != .unlocked)
            }
            if model.state != .unlocked { unlockControls }
        }
    }

    private var secretsTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.state != .unlocked { unlockControls }
            TextField("Search aliases across projects…", text: $query)
                .textFieldStyle(.roundedBorder)
            if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !model.recent.isEmpty {
                Text("RECENT").font(.caption2).foregroundStyle(.secondary)
                ForEach(model.recent) { entryRow($0) }
                Divider()
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    if filtered.isEmpty {
                        Text(model.entries.isEmpty ? "No .secret.json projects found in ~/dev" : "No matches")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 20)
                            .frame(maxWidth: .infinity)
                    } else {
                        ForEach(filtered) { entry in entryRow(entry) }
                    }
                }
            }
        }
    }

    private func entryRow(_ entry: AliasEntry) -> some View {
        HStack(spacing: 8) {
            Button { copying = entry } label: {
                HStack {
                    Text(entry.alias)
                        .font(.system(.body, design: .monospaced))
                        .lineLimit(1)
                    Spacer()
                    Text(entry.project).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Image(systemName: "doc.on.doc").foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.busy || model.state != .unlocked)
            .contextMenu {
                Button("Edit…") { editing = entry }
                Button("Open source URL") { model.openSource(entry) }
                Button("Rotate and copy new value") { rotating = entry }
            }
        }
        .padding(.vertical, 2)
    }

    private var settingsTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Settings").font(.title3.weight(.semibold))
            Text("SecretBar uses the same native secret CLI, Bitwarden session, and Touch ID flow as the terminal command.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Text("Status")
                Spacer()
                StatusDot(state: model.state)
                Text(stateLabel).foregroundStyle(.secondary)
            }
            if let sessionCreated = model.sessionCreated {
                Text("Stored session from \(sessionCreated)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text("Global aliases: ~/.config/secret/config.json")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("Projects: ~/dev/*/.secret.json")
                .font(.caption)
                .foregroundStyle(.secondary)
            if model.state != .unlocked { unlockControls }
            else {
                Button("Lock vault") { model.lock() }
                    .disabled(model.busy)
            }
            Spacer()
        }
    }

    private var unlockControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !showPassword {
                HStack {
                    Button { model.unlockWithTouchID() } label: {
                        Label("Unlock with Touch ID", systemImage: "touchid")
                    }
                    .disabled(model.busy)
                    Button("Master password…") { showPassword = true }
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

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            let health = model.problems.filter { $0.value > 0 }
            if !health.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
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
            Button("Quit SecretBar") { NSApplication.shared.terminate(nil) }
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
