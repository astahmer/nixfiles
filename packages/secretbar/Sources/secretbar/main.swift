import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

// SecretBar is a deliberately value-minimizing UI around the `secret` CLI.
// Normal copy operations stay in the CLI process and write directly to the
// clipboard. Values enter this process only when the user enables hold-to-
// reveal and actively holds on a row.

// MARK: - Process helpers

struct RunResult {
    var status: Int32
    var stdout: String
    var stderr: String
}

func homeDirectory() -> String {
    ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
}

func secretBin() -> String {
    let home = homeDirectory()
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

func toolBin(_ name: String) -> String {
    let home = homeDirectory()
    let candidates = [
        "\(home)/.nix-profile/bin/\(name)",
        "/opt/homebrew/bin/\(name)",
        "/usr/local/bin/\(name)",
        "/usr/bin/\(name)",
    ]
    for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
        return candidate
    }
    return name
}

func runProcess(
    executable: String,
    arguments: [String],
    cwd: String? = nil,
    input: String? = nil,
    timeout: TimeInterval = 45
) -> RunResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let cwd {
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
    }

    var environment = ProcessInfo.processInfo.environment
    let home = homeDirectory()
    environment["HOME"] = home
    environment["PATH"] = "\(home)/.nix-profile/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    process.environment = environment

    let output = Pipe()
    let error = Pipe()
    process.standardOutput = output
    process.standardError = error
    if let input {
        let inputPipe = Pipe()
        process.standardInput = inputPipe
        DispatchQueue.global().async {
            try? inputPipe.fileHandleForWriting.write(contentsOf: Data((input + "\n").utf8))
            try? inputPipe.fileHandleForWriting.close()
        }
    } else {
        process.standardInput = FileHandle.nullDevice
    }

    do {
        try process.run()
    } catch {
        return RunResult(status: 127, stdout: "", stderr: String(describing: error))
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

    let stdout = (try? output.fileHandleForReading.readToEnd()).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    let stderr = (try? error.fileHandleForReading.readToEnd()).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    return RunResult(status: process.terminationStatus, stdout: stdout, stderr: stderr)
}

func runSecret(
    _ arguments: [String],
    cwd: String? = nil,
    input: String? = nil,
    timeout: TimeInterval = 45
) -> RunResult {
    runProcess(executable: secretBin(), arguments: arguments, cwd: cwd, input: input, timeout: timeout)
}

func runTool(
    _ name: String,
    _ arguments: [String],
    input: String? = nil,
    timeout: TimeInterval = 45
) -> RunResult {
    runProcess(executable: toolBin(name), arguments: arguments, input: input, timeout: timeout)
}

func copyText(_ value: String) -> Bool {
    let result = runProcess(executable: "/usr/bin/pbcopy", arguments: [], input: value, timeout: 5)
    return result.status == 0
}

func openPath(_ path: String) {
    NSWorkspace.shared.open(URL(fileURLWithPath: path))
}

func openTerminal() {
    let terminal = "/System/Applications/Utilities/Terminal.app"
    openPath(FileManager.default.fileExists(atPath: terminal) ? terminal : "/Applications/Utilities/Terminal.app")
}

// MARK: - Models

struct Project: Identifiable, Hashable {
    let name: String
    let dir: String

    var id: String { dir }
    var isGlobal: Bool { name == "global" }
    var configPath: String {
        isGlobal ? "\(dir)/.config/secret/config.json" : "\(dir)/.secret.json"
    }
}

enum SecretItemType: String, CaseIterable, Identifiable {
    case login
    case secureNote = "secure-note"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .login: return "Login / secret"
        case .secureNote: return "Secure Note"
        }
    }
    var field: String {
        switch self {
        case .login: return "password"
        case .secureNote: return "notes"
        }
    }
}

struct AliasEntry: Identifiable, Hashable {
    let alias: String
    let project: String
    let configPath: String
    let cwd: String
    let item: String
    let environment: String
    let field: String
    let itemType: String
    let envKey: String
    let tags: [String]
    let expiresAt: String?

    var id: String { "\(project):\(environment):\(alias)" }
    var itemTypeTitle: String { itemType == SecretItemType.secureNote.rawValue ? "Secure Note" : "Login" }
}

struct ImportCandidate: Identifiable {
    let alias: String
    let value: String
    var id: String { alias }
}

struct UsageEntry: Identifiable, Hashable {
    let id: String
    let at: String
    let command: String
    let target: String
    let environment: String
}

struct SecretDiagnostic: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let recoveryCommand: String?
    let canRepairBitwarden: Bool
}

struct RemoteEntryMetadata: Hashable {
    let status: String
    let itemName: String?
    let source: String?
    let hasTOTP: Bool

    var isUsable: Bool { status == "ok" }
}

enum VaultState {
    case unknown
    case unlocked
    case locked
    case unauthenticated
    case error
}

enum SecretBarTab: String, CaseIterable, Identifiable {
    case create
    case secrets
    case settings

    var id: String { rawValue }
    var title: String {
        switch self {
        case .create: return "Create"
        case .secrets: return "My Secrets"
        case .settings: return "Settings"
        }
    }
}

private enum PreferenceKey {
    static let pinnedIDs = "secretbar.pinnedIDs"
    static let pinsEnabled = "secretbar.pinsEnabled"
    static let shortcutsEnabled = "secretbar.shortcutsEnabled"
    static let autoDetectProject = "secretbar.autoDetectProject"
    static let holdToReveal = "secretbar.holdToReveal"
    static let clipboardClearSeconds = "secretbar.clipboardClearSeconds"
    static let expiryWarningDays = "secretbar.expiryWarningDays"
}

// MARK: - Model

@MainActor
final class SecretBarModel: ObservableObject {
    static let shared = SecretBarModel()

    @Published var state: VaultState = .unknown
    @Published var projects: [Project] = []
    @Published var entries: [AliasEntry] = []
    @Published var recent: [AliasEntry] = []
    @Published var history: [UsageEntry] = []
    @Published var problems: [String: Int] = [:]
    @Published var problemDetails: [String: [String]] = [:]
    @Published var sessionCreated: String?
    @Published var detectedProjectID: String?
    @Published var contextPath: String?
    @Published var busy = false
    @Published var flash: String?
    @Published var lastError: String?
    @Published var diagnostic: SecretDiagnostic?
    @Published var importCandidates: [ImportCandidate] = []
    @Published var importProject: Project?
    @Published var importEnvironment = "prod"
    @Published var remoteMetadata: [String: RemoteEntryMetadata] = [:]
    @Published var remoteValidationComplete = false
    @Published var remoteValidationInProgress = false

    @Published var pinnedIDs: Set<String> = Set(UserDefaults.standard.stringArray(forKey: PreferenceKey.pinnedIDs) ?? []) {
        didSet { UserDefaults.standard.set(Array(pinnedIDs).sorted(), forKey: PreferenceKey.pinnedIDs) }
    }
    @Published var pinsEnabled: Bool = SecretBarModel.preferenceBool(PreferenceKey.pinsEnabled, defaultValue: true) {
        didSet { UserDefaults.standard.set(pinsEnabled, forKey: PreferenceKey.pinsEnabled) }
    }
    @Published var shortcutsEnabled: Bool = SecretBarModel.preferenceBool(PreferenceKey.shortcutsEnabled, defaultValue: true) {
        didSet { UserDefaults.standard.set(shortcutsEnabled, forKey: PreferenceKey.shortcutsEnabled) }
    }
    @Published var autoDetectProject: Bool = SecretBarModel.preferenceBool(PreferenceKey.autoDetectProject, defaultValue: true) {
        didSet {
            UserDefaults.standard.set(autoDetectProject, forKey: PreferenceKey.autoDetectProject)
            refreshDetectedProject()
        }
    }
    @Published var holdToReveal: Bool = SecretBarModel.preferenceBool(PreferenceKey.holdToReveal, defaultValue: false) {
        didSet { UserDefaults.standard.set(holdToReveal, forKey: PreferenceKey.holdToReveal) }
    }
    @Published var clipboardClearSeconds: Int = UserDefaults.standard.integer(forKey: PreferenceKey.clipboardClearSeconds) {
        didSet { UserDefaults.standard.set(clipboardClearSeconds, forKey: PreferenceKey.clipboardClearSeconds) }
    }
    @Published var expiryWarningDays: Int = {
        let value = UserDefaults.standard.integer(forKey: PreferenceKey.expiryWarningDays)
        return value == 0 ? 14 : value
    }() {
        didSet { UserDefaults.standard.set(expiryWarningDays, forKey: PreferenceKey.expiryWarningDays) }
    }

    private var statusTimer: Timer?
    private var healthTimer: Timer?
    private var flashTask: Task<Void, Never>?
    private var clipboardTask: Task<Void, Never>?
    private var lastUsedByKey: [String: String] = [:]

    private static func preferenceBool(_ key: String, defaultValue: Bool) -> Bool {
        guard UserDefaults.standard.object(forKey: key) != nil else { return defaultValue }
        return UserDefaults.standard.bool(forKey: key)
    }

    func start() {
        refreshEverything()
        guard statusTimer == nil else { return }
        statusTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.refreshStatus()
                self.refreshIndex()
                self.refreshHistory()
            }
        }
        healthTimer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.refreshHealth() }
        }
    }

    func refreshEverything() {
        refreshStatus()
        refreshIndex()
        refreshHistory()
        refreshSessionAge()
        refreshHealth()
    }

    func refreshStatus() {
        let result = runSecret(["status", "--check"])
        let output = "\(result.stdout)\n\(result.stderr)".lowercased()
        if result.status == 0 {
            state = .unlocked
        } else if output.contains("unauthenticated") {
            state = .unauthenticated
        } else if output.contains("locked") {
            state = .locked
        } else {
            state = .error
        }
    }

    func refreshIndex() {
        let home = homeDirectory()
        let devDir = "\(home)/dev"
        var found: [Project] = []
        if let items = try? FileManager.default.contentsOfDirectory(atPath: devDir) {
            for name in items.sorted() where !name.hasPrefix(".") {
                let dir = "\(devDir)/\(name)"
                var isDirectory: ObjCBool = false
                guard FileManager.default.fileExists(atPath: dir, isDirectory: &isDirectory), isDirectory.boolValue else {
                    continue
                }
                if FileManager.default.fileExists(atPath: "\(dir)/.secret.json") {
                    found.append(Project(name: name, dir: dir))
                }
            }
        }
        found.append(Project(name: "global", dir: home))
        projects = found

        var indexed: [AliasEntry] = []
        for project in found {
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: project.configPath)),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { continue }

            var definitions: [(String, [String: Any], String)] = []
            if let secrets = json["secrets"] as? [String: Any] {
                definitions += secrets.compactMap { alias, definition in
                    guard let definition = definition as? [String: Any] else { return nil }
                    return (alias, definition, "prod")
                }
            }
            if let environments = json["environments"] as? [String: Any] {
                for environment in environments.keys.sorted() {
                    guard let environmentObject = environments[environment] as? [String: Any],
                          let secrets = environmentObject["secrets"] as? [String: Any]
                    else { continue }
                    definitions += secrets.compactMap { alias, definition in
                        guard let definition = definition as? [String: Any] else { return nil }
                        return (alias, definition, environment)
                    }
                }
            }

            for (alias, definition, environment) in definitions.sorted(by: { $0.0 == $1.0 ? $0.2 < $1.2 : $0.0 < $1.0 }) {
                guard let item = definition["item"] as? String, !item.isEmpty else { continue }
                indexed.append(AliasEntry(
                    alias: alias,
                    project: project.name,
                    configPath: project.configPath,
                    cwd: project.dir,
                    item: item,
                    environment: environment,
                    field: definition["field"] as? String ?? "password",
                    itemType: definition["type"] as? String ?? "login",
                    envKey: definition["env"] as? String ?? alias,
                    tags: definition["tags"] as? [String] ?? [],
                    expiresAt: definition["expiresAt"] as? String
                ))
            }
        }
        entries = indexed
        let currentIDs = Set(indexed.map(\.id))
        remoteMetadata = remoteMetadata.filter { currentIDs.contains($0.key) }
        if state == .unlocked && !indexed.allSatisfy({ remoteMetadata[$0.id] != nil }) {
            remoteValidationComplete = false
        }
        refreshDetectedProject()
        refreshHistory()
    }

    func refreshDetectedProject() {
        guard autoDetectProject else {
            detectedProjectID = nil
            return
        }
        let path = "\(homeDirectory())/.config/secretbar/context"
        contextPath = try? String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let contextPath, !contextPath.isEmpty else {
            detectedProjectID = nil
            return
        }
        let candidates = projects
            .filter { !$0.isGlobal && (contextPath == $0.dir || contextPath.hasPrefix("\($0.dir)/")) }
            .sorted { $0.dir.count > $1.dir.count }
        detectedProjectID = candidates.first?.id
    }

    func refreshHistory() {
        let path = "\(homeDirectory())/.config/secret/history.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else {
            history = []
            recent = []
            lastUsedByKey = [:]
            return
        }

        let parsed = json.enumerated().compactMap { index, row -> UsageEntry? in
            guard let at = row["at"] as? String,
                  let command = row["cmd"] as? String,
                  let target = row["target"] as? String
            else { return nil }
            return UsageEntry(
                id: "\(index)-\(at)-\(target)",
                at: at,
                command: command,
                target: target,
                environment: row["env"] as? String ?? "prod"
            )
        }.sorted { $0.at > $1.at }
        history = parsed

        var lastUsed: [String: String] = [:]
        for item in parsed where item.command == "get" || item.command == "set" || item.command == "rotate" {
            let key = "\(item.environment):\(item.target)"
            if lastUsed[key] == nil { lastUsed[key] = item.at }
        }
        lastUsedByKey = lastUsed

        var recentAliases: [(String, String)] = []
        for item in parsed where item.command == "get" || item.command == "set" || item.command == "rotate" {
            let key = "\(item.environment):\(item.target)"
            if !recentAliases.contains(where: { $0.0 == key }) { recentAliases.append((key, item.environment)) }
            if recentAliases.count == 8 { break }
        }
        recent = recentAliases.compactMap { key, environment in
            let alias = key.split(separator: ":", maxSplits: 1).last.map(String.init) ?? key
            return entryForAlias(alias, environment: environment)
        }
    }

    private func entryForAlias(_ alias: String, environment: String = "prod") -> AliasEntry? {
        if let detectedProjectID,
           let detected = entries.first(where: { $0.project == detectedProjectID && $0.alias == alias && $0.environment == environment }) {
            return detected
        }
        return entries.first(where: { $0.alias == alias && $0.environment == environment })
    }

    func refreshHealth() {
        guard state == .unlocked else {
            problems = [:]
            problemDetails = [:]
            remoteValidationInProgress = false
            return
        }

        let entriesToCheck = entries
        remoteValidationComplete = false
        remoteValidationInProgress = true
        Task.detached(priority: .utility) {
            var counts: [String: Int] = [:]
            var details: [String: [String]] = [:]
            var metadata: [String: RemoteEntryMetadata] = [:]
            let groups = Dictionary(grouping: entriesToCheck) { entry in
                "\(entry.configPath)\u{0}\(entry.environment)"
            }

            for groupedEntries in groups.values {
                guard let first = groupedEntries.first else { continue }
                var arguments = ["doctor", "--config", first.configPath, "--json"]
                if first.environment != "prod" { arguments += ["--env", first.environment] }
                let result = runSecret(arguments, cwd: first.cwd, timeout: 45)
                guard let data = result.stdout.data(using: .utf8),
                      let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
                else { continue }

                for row in rows {
                    guard let alias = row["alias"] as? String,
                          let entry = groupedEntries.first(where: { $0.alias == alias })
                    else { continue }
                    let status = row["status"] as? String ?? "missing"
                    let itemName = (row["itemName"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                    let source = (row["source"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                    let hasTOTP = (row["hasTOTP"] as? String) == "true" || (row["hasTOTP"] as? Bool) == true
                    metadata[entry.id] = RemoteEntryMetadata(
                        status: status,
                        itemName: itemName,
                        source: source,
                        hasTOTP: hasTOTP
                    )
                    if status != "ok" {
                        counts[entry.project, default: 0] += 1
                        details[entry.project, default: []].append(
                            "\(status)\t\(entry.alias)\t\(entry.item)\t\(entry.field)"
                        )
                    }
                }
            }
            let snapshotCounts = counts
            let snapshotDetails = details
            let snapshotMetadata = metadata
            await MainActor.run {
                self.problems = snapshotCounts
                self.problemDetails = snapshotDetails
                self.remoteMetadata = snapshotMetadata
                self.remoteValidationComplete = true
                self.remoteValidationInProgress = false
            }
        }
    }

    nonisolated static func parseProblems(_ text: String) -> Int {
        guard let match = text.range(of: #"[0-9]+ problem\(s\)"#, options: .regularExpression) else { return 0 }
        return Int(text[match].filter(\.isNumber)) ?? 0
    }

    func refreshSessionAge() {
        let process = runProcess(
            executable: "/usr/bin/security",
            arguments: ["find-generic-password", "-a", "bitwarden-session", "-s", "secret-cli"],
            timeout: 5
        )
        guard process.status == 0 else {
            sessionCreated = nil
            return
        }
        let pattern = #"20\d\d-\d\d-\d\d[ T]\d\d:\d\d:\d\d"#
        guard let range = process.stdout.range(of: pattern, options: .regularExpression) else { return }
        let raw = String(process.stdout[range]).replacingOccurrences(of: "T", with: " ")
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd HH:mm:ss"
        parser.locale = Locale(identifier: "en_US_POSIX")
        guard let date = parser.date(from: raw) else { return }
        let display = DateFormatter()
        display.dateFormat = "yyyy-MM-dd HH:mm"
        sessionCreated = display.string(from: date)
    }

    func copy(_ entry: AliasEntry) {
        setBusy(true)
        let result = runSecret(scoped(["get", "--copy", "--config", entry.configPath, entry.alias], entry), cwd: entry.cwd)
        setBusy(false)
        guard result.status == 0 else {
            showError(title: "Could not copy \(entry.alias)", message: resultDetail(result, fallback: "secret get failed"))
            return
        }
        scheduleClipboardClear()
        flash("copied \(entry.alias)")
        refreshHistory()
    }

    func reveal(_ entry: AliasEntry) -> String? {
        setBusy(true)
        let result = runSecret(scoped(["get", "--config", entry.configPath, entry.alias], entry), cwd: entry.cwd)
        setBusy(false)
        guard result.status == 0 else {
            showError(title: "Could not reveal \(entry.alias)", message: resultDetail(result, fallback: "secret get failed"))
            return nil
        }
        return result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func openSource(_ entry: AliasEntry) {
        setBusy(true)
        let result = runSecret(scoped(["source", "--config", entry.configPath, entry.alias, "--open"], entry), cwd: entry.cwd)
        setBusy(false)
        if result.status == 0 {
            flash("opened source for \(entry.alias)")
        } else {
            showError(title: "No source for \(entry.alias)", message: resultDetail(result, fallback: "This item has no source URL."))
        }
    }

    func rotate(_ entry: AliasEntry) {
        setBusy(true)
        let result = runSecret(scoped(["rotate", "--config", entry.configPath, entry.alias, "--force"], entry), cwd: entry.cwd, timeout: 60)
        setBusy(false)
        if result.status == 0 {
            scheduleClipboardClear()
            flash("rotated \(entry.alias) — new value copied")
            refreshHistory()
        } else {
            showError(title: "Could not rotate \(entry.alias)", message: resultDetail(result, fallback: "secret rotate failed"))
        }
    }

    func create(
        alias: String,
        project: Project,
        value: String,
        itemName: String,
        source: String,
        notes: String,
        itemType: SecretItemType,
        expiresAt: String,
        environment: String,
        tags: String
    ) -> Bool {
        let cleanAlias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanAlias.isEmpty else {
            showError(title: "Cannot create secret", message: "Enter an alias.")
            return false
        }
        guard !cleanValue.isEmpty else {
            showError(title: "Cannot create secret", message: "Enter a value.")
            return false
        }
        var arguments = ["set", cleanAlias, "--type", itemType.rawValue]
        let cleanEnvironment = environment.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanEnvironment.isEmpty && cleanEnvironment != "prod" { arguments += ["--env", cleanEnvironment] }
        if project.isGlobal {
            arguments.append("--global")
        } else {
            arguments += ["--config", project.configPath]
        }
        if !itemName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { arguments += ["--name", itemName] }
        if !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { arguments += ["--source", source] }
        if itemType == .login, !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { arguments += ["--notes", notes] }
        if !expiresAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { arguments += ["--expires-at", expiresAt] }
        if !tags.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { arguments += ["--tags", tags] }

        setBusy(true)
        let result = runSecret(arguments, cwd: project.dir, input: cleanValue, timeout: 60)
        setBusy(false)
        guard result.status == 0 else {
            showError(title: "Could not create \(cleanAlias)", message: resultDetail(result, fallback: "secret set failed"))
            return false
        }
        flash("created \(cleanAlias) in \(project.isGlobal ? "global" : project.name)")
        refreshEverything()
        return true
    }

    func prepareImport(url: URL, project: Project, environment: String) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else {
            showError(title: "Could not read dotenv file", message: "SecretBar could not read the selected file.")
            return
        }
        let candidates = contents.split(separator: "\n", omittingEmptySubsequences: false).compactMap { raw -> ImportCandidate? in
            var line = String(raw).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#") else { return nil }
            if line.hasPrefix("export ") { line.removeFirst("export ".count) }
            guard let separator = line.firstIndex(of: "=") else { return nil }
            let key = String(line[..<separator])
            guard key.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil else { return nil }
            var value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
            if value.count >= 2 {
                let first = value.first
                let last = value.last
                if (first == "'" && last == "'") || (first == "\"" && last == "\"") {
                    value.removeFirst()
                    value.removeLast()
                }
            }
            return ImportCandidate(alias: key.lowercased().replacingOccurrences(of: "_", with: "-"), value: value)
        }
        guard !candidates.isEmpty else {
            showError(title: "No importable entries", message: "The selected file did not contain simple KEY=value entries.")
            return
        }
        importCandidates = candidates
        importProject = project
        importEnvironment = environment
    }

    func confirmImport() {
        guard let project = importProject else { return }
        let candidates = importCandidates
        let existing = Set(entries.filter { $0.project == project.name && $0.environment == importEnvironment }.map(\.alias))
        let skipped = candidates.filter { existing.contains($0.alias) }.map(\.alias)
        var failures: [String] = []
        setBusy(true)
        for candidate in candidates where !existing.contains(candidate.alias) {
            var arguments = ["set", candidate.alias]
            if project.isGlobal { arguments.append("--global") } else { arguments += ["--config", project.configPath] }
            if importEnvironment != "prod" { arguments += ["--env", importEnvironment] }
            let result = runSecret(arguments, cwd: project.dir, input: candidate.value, timeout: 60)
            if result.status != 0 { failures.append("\(candidate.alias): \(resultDetail(result, fallback: "failed"))") }
        }
        setBusy(false)
        importCandidates = []
        importProject = nil
        refreshEverything()
        if !failures.isEmpty {
            showError(title: "Import completed with errors", message: ((skipped.isEmpty ? [] : ["Skipped existing aliases: \(skipped.joined(separator: ", "))"]) + failures).joined(separator: "\n"))
        } else if !skipped.isEmpty {
            flash("imported new aliases; skipped existing: \(skipped.joined(separator: ", "))")
        } else {
            flash("imported \(candidates.count) aliases")
        }
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
            showError(title: "Nothing to save", message: "Enter a change first.")
            return false
        }
        var arguments = scoped(["edit", entry.alias, "--config", entry.configPath, "--force"], entry)
        if !cleanName.isEmpty { arguments += ["--name", itemName] }
        if !cleanValue.isEmpty { arguments += ["--field", entry.field, "--value-stdin"] }
        if clearSource || cleanSource?.isEmpty == false { arguments += ["--source", clearSource ? "" : source ?? ""] }
        if clearNotes || cleanNotes?.isEmpty == false { arguments += ["--notes", clearNotes ? "" : notes ?? ""] }

        setBusy(true)
        let result = runSecret(arguments, cwd: entry.cwd, input: cleanValue.isEmpty ? nil : cleanValue, timeout: 60)
        setBusy(false)
        guard result.status == 0 else {
            showError(title: "Could not edit \(entry.alias)", message: resultDetail(result, fallback: "secret edit failed"))
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
            showError(title: "Touch ID unlock failed", message: resultDetail(result, fallback: "Touch ID authenticated, but Bitwarden is still locked."))
            refreshStatus()
        }
    }

    func copyTOTP(_ entry: AliasEntry) {
        setBusy(true)
        let result = runSecret(scoped(["totp", "--copy", "--config", entry.configPath, entry.alias], entry), cwd: entry.cwd)
        setBusy(false)
        if result.status == 0 {
            scheduleClipboardClear()
            flash("copied current TOTP for \(entry.alias)")
            refreshHistory()
        } else {
            showError(title: "Could not copy TOTP", message: resultDetail(result, fallback: "secret totp failed"))
        }
    }

    func unlockWithPassword(_ password: String) {
        guard !password.isEmpty else { return }
        setBusy(true)
        let result = runSecret(["unlock", "--store"], input: password, timeout: 60)
        let verified = result.status == 0 && runSecret(["status", "--check"], timeout: 30).status == 0
        setBusy(false)
        if verified {
            flash("unlocked; session stored")
            refreshEverything()
        } else {
            showError(title: "Password unlock failed", message: resultDetail(result, fallback: "Bitwarden is still locked."))
            refreshStatus()
        }
    }

    func lock() {
        setBusy(true)
        _ = runSecret(["lock"])
        setBusy(false)
        state = .locked
        flash("vault locked")
    }

    func togglePin(_ entry: AliasEntry) {
        guard pinsEnabled else { return }
        if pinnedIDs.contains(entry.id) {
            pinnedIDs.remove(entry.id)
        } else {
            pinnedIDs.insert(entry.id)
        }
    }

    func clearHistory() {
        let path = "\(homeDirectory())/.config/secret/history.json"
        try? FileManager.default.removeItem(atPath: path)
        refreshHistory()
        flash("usage history cleared")
    }

    func copyDiagnostic(_ diagnostic: SecretDiagnostic) {
        guard let command = diagnostic.recoveryCommand else { return }
        if copyText(command) {
            flash("recovery command copied")
        } else {
            showError(title: "Could not copy command", message: "pbcopy is unavailable. Select the command manually.")
        }
    }

    func repairBitwardenSession() {
        setBusy(true)
        let result = runTool("bw", ["logout"], timeout: 30)
        setBusy(false)
        state = .locked
        let command = "bw login\nsecret unlock --store"
        _ = copyText(command)
        openTerminal()
        if result.status == 0 {
            diagnostic = SecretDiagnostic(
                title: "Bitwarden session reset",
                message: "Bitwarden CLI was logged out. The next steps were copied to the clipboard and Terminal was opened. Complete login there, then return to SecretBar.",
                recoveryCommand: command,
                canRepairBitwarden: false
            )
        } else {
            diagnostic = SecretDiagnostic(
                title: "Bitwarden reset needs attention",
                message: resultDetail(result, fallback: "Could not run bw logout.") + "\n\nThe recovery command was copied to the clipboard.",
                recoveryCommand: command,
                canRepairBitwarden: false
            )
        }
    }

    func showHealthDiagnostics() {
        let lines = problemDetails
            .sorted { $0.key < $1.key }
            .flatMap { project, details in details.map { "\(project): \($0)" } }
        let message = lines.isEmpty
            ? "One or more projects need attention. Unlock the vault and run secret doctor for details."
            : lines.joined(separator: "\n")
        diagnostic = SecretDiagnostic(
            title: "Secret health",
            message: message,
            recoveryCommand: "secret doctor",
            canRepairBitwarden: false
        )
    }

    func showError(title: String, message: String) {
        lastError = message
        let lower = message.lowercased()
        let staleSession = lower.contains("stale secure-storage") || lower.contains("rejected the new session")
        diagnostic = SecretDiagnostic(
            title: title,
            message: message,
            recoveryCommand: staleSession ? "bw logout\nbw login\nsecret unlock --store" : nil,
            canRepairBitwarden: staleSession
        )
    }

    func flash(_ message: String) {
        flash = message
        flashTask?.cancel()
        flashTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled { self?.flash = nil }
        }
    }

    func health(for entry: AliasEntry) -> String {
        if let count = problems[entry.project], count > 0 { return "Needs attention" }
        if let expiresAt = entry.expiresAt,
           let expiry = parseDate(expiresAt) {
            if expiry < Date() { return "Expired" }
            if expiry < Date().addingTimeInterval(TimeInterval(expiryWarningDays * 86_400)) { return "Expires soon" }
        }
        return "OK"
    }

    func hasTOTP(_ entry: AliasEntry) -> Bool {
        remoteMetadata[entry.id]?.isUsable == true && remoteMetadata[entry.id]?.hasTOTP == true
    }

    func hasSource(_ entry: AliasEntry) -> Bool {
        remoteMetadata[entry.id]?.source?.isEmpty == false
    }

    func lastUsed(for entry: AliasEntry) -> String {
        guard let value = lastUsedByKey["\(entry.environment):\(entry.alias)"], let date = parseDate(value) else { return "Never" }
        return formatDate(date)
    }

    private func scheduleClipboardClear() {
        clipboardTask?.cancel()
        guard clipboardClearSeconds > 0 else { return }
        let expectedChangeCount = NSPasteboard.general.changeCount
        let seconds = clipboardClearSeconds
        clipboardTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000)
            guard !Task.isCancelled, NSPasteboard.general.changeCount == expectedChangeCount else { return }
            NSPasteboard.general.clearContents()
            self?.flash("clipboard cleared")
        }
    }

    private func setBusy(_ value: Bool) {
        busy = value
    }

    private func scoped(_ arguments: [String], _ entry: AliasEntry) -> [String] {
        entry.environment == "prod" ? arguments : arguments + ["--env", entry.environment]
    }

    private func resultDetail(_ result: RunResult, fallback: String) -> String {
        let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        if !detail.isEmpty { return detail }
        let output = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        return output.isEmpty ? fallback : output
    }
}

func parseDate(_ value: String) -> Date? {
    if let date = ISO8601DateFormatter().date(from: value) { return date }
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    return formatter.date(from: value)
}

func formatDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    return formatter.string(from: date)
}

// MARK: - Reusable views

struct StatusDot: View {
    let state: VaultState

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 11, height: 11)
    }

    private var color: Color {
        switch state {
        case .unlocked: return .green
        case .locked: return .orange
        case .unauthenticated, .error: return .red
        case .unknown: return .gray
        }
    }
}

struct StatusIcon: View {
    let state: VaultState

    var body: some View {
        Image(systemName: symbol)
    }

    private var symbol: String {
        switch state {
        case .unlocked: return "lock.open.fill"
        case .locked: return "lock.fill"
        case .unauthenticated, .error: return "exclamationmark.triangle.fill"
        case .unknown: return "circle.dashed"
        }
    }
}

struct MasterPasswordSheet: View {
    @ObservedObject var model: SecretBarModel
    let onDismiss: () -> Void
    @State private var password = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Unlock Bitwarden").font(.title3.weight(.semibold))
            Text("Your password is sent to the native secret CLI and is not stored by SecretBar.")
                .font(.caption)
                .foregroundStyle(.secondary)
            SecureField("Master password", text: $password)
                .textFieldStyle(.roundedBorder)
                .onSubmit { unlock() }
            HStack {
                Spacer()
                Button("Cancel") { onDismiss() }
                Button("Unlock") { unlock() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.busy || password.isEmpty)
            }
        }
        .padding(18)
        .frame(width: 380)
    }

    private func unlock() {
        let value = password
        password = ""
        onDismiss()
        model.unlockWithPassword(value)
    }
}

struct DiagnosticSheet: View {
    @ObservedObject var model: SecretBarModel
    let diagnostic: SecretDiagnostic
    let onDismiss: () -> Void
    @State private var confirmReset = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Text(diagnostic.title).font(.title3.weight(.semibold))
            }
            ScrollView {
                Text(diagnostic.message)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .font(.system(.body, design: .monospaced))
            }
            if let command = diagnostic.recoveryCommand {
                Text("Suggested command")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(command)
                    .textSelection(.enabled)
                    .font(.system(.callout, design: .monospaced))
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 6))
            }
            if confirmReset {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Reset the Bitwarden CLI session?").font(.headline)
                    Text("This logs Bitwarden out. You will need to complete bw login again.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Spacer()
                        Button("Cancel") { confirmReset = false }
                        Button("Log out and open Terminal", role: .destructive) {
                            onDismiss()
                            model.repairBitwardenSession()
                        }
                    }
                }
                .padding(10)
                .background(Color.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 7))
            } else {
                HStack {
                    if diagnostic.recoveryCommand != nil {
                        Button("Copy command") {
                            model.copyDiagnostic(diagnostic)
                            onDismiss()
                        }
                        Button("Open Terminal") {
                            onDismiss()
                            openTerminal()
                        }
                    }
                    if diagnostic.canRepairBitwarden {
                        Button("Reset Bitwarden session", role: .destructive) { confirmReset = true }
                    }
                    Spacer()
                    Button("Dismiss") { onDismiss() }
                }
            }
        }
        .padding(18)
        .frame(width: 560, height: 390)
    }
}

struct SecretEditSheet: View {
    @ObservedObject var model: SecretBarModel
    let entry: AliasEntry
    let onDismiss: () -> Void
    @State private var itemName = ""
    @State private var value = ""
    @State private var source = ""
    @State private var notes = ""
    @State private var clearSource = false
    @State private var clearNotes = false

    init(model: SecretBarModel, entry: AliasEntry, onDismiss: @escaping () -> Void) {
        self.model = model
        self.entry = entry
        self.onDismiss = onDismiss
        _itemName = State(initialValue: model.remoteMetadata[entry.id]?.itemName ?? "")
        _source = State(initialValue: model.remoteMetadata[entry.id]?.source ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Edit \(entry.alias)").font(.headline)
            Text("\(entry.project) · blank fields keep their current values")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Bitwarden item name", text: $itemName).textFieldStyle(.roundedBorder)
            SecureField("New value (optional)", text: $value).textFieldStyle(.roundedBorder)
            TextField("Source URL (optional)", text: $source).textFieldStyle(.roundedBorder)
            Toggle("Clear source", isOn: $clearSource).toggleStyle(.checkbox)
            TextEditor(text: $notes)
                .font(.body)
                .frame(minHeight: 70, maxHeight: 110)
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.secondary.opacity(0.25)))
            Toggle("Clear notes", isOn: $clearNotes).toggleStyle(.checkbox)
            HStack {
                Spacer()
                Button("Cancel") { onDismiss() }
                Button("Save changes") {
                    if model.edit(entry, itemName: itemName, value: value, source: source, notes: notes, clearSource: clearSource, clearNotes: clearNotes) {
                        onDismiss()
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.busy)
            }
        }
        .padding(16)
        .frame(width: 430, height: 420)
    }
}

struct ImportPreviewSheet: View {
    @ObservedObject var model: SecretBarModel
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Import dotenv entries").font(.title3.weight(.semibold))
            Text("Only aliases and values from the selected file are read. Existing aliases in the selected project/environment are skipped, never overwritten.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text("\(model.importCandidates.count) entries ready for \(model.importProject?.name ?? "project") / \(model.importEnvironment)")
                .font(.headline)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(model.importCandidates) { candidate in
                        HStack {
                            Text(candidate.alias).font(.system(.body, design: .monospaced))
                            Spacer()
                            Text("value hidden").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Button("Cancel") { model.importCandidates = []; onDismiss() }
                Button("Create missing secrets") {
                    model.confirmImport()
                    onDismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.busy)
            }
        }
        .padding(18)
        .frame(width: 430, height: 430)
    }
}

struct SecretBarConfirmation: View {
    let title: String
    let message: String
    let confirmTitle: String
    let destructive: Bool
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.weight(.semibold))
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Cancel") { onCancel() }
                if destructive {
                    Button(confirmTitle, role: .destructive) { onConfirm() }
                } else {
                    Button(confirmTitle) { onConfirm() }
                }
            }
        }
        .padding(18)
        .frame(width: 430)
    }
}

// MARK: - Main view

struct SecretBarView: View {
    @EnvironmentObject var model: SecretBarModel
    @State private var tab: SecretBarTab = .secrets
    @State private var query = ""
    @State private var copying: AliasEntry?
    @State private var rotating: AliasEntry?
    @State private var editing: AliasEntry?
    @State private var revealingID: String?
    @State private var revealedValue = ""
    @State private var showPasswordSheet = false
    @State private var selectedProjectID = ""
    @State private var createAlias = ""
    @State private var createItemName = ""
    @State private var createValue = ""
    @State private var createSource = ""
    @State private var createNotes = ""
    @State private var createType: SecretItemType = .login
    @State private var createExpiresAt = ""
    @State private var createEnvironment = "prod"
    @State private var createTags = ""
    @State private var showDotEnvImporter = false
    @State private var showImportPreview = false
    @State private var confirmClearHistory = false

    private var matchingEntries: [AliasEntry] {
        let sourceEntries: [AliasEntry]
        if model.state == .unlocked {
            sourceEntries = model.remoteValidationComplete
                ? model.entries.filter { model.remoteMetadata[$0.id]?.isUsable == true }
                : []
        } else {
            sourceEntries = model.entries
        }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return sourceEntries }
        return sourceEntries.filter {
            $0.alias.lowercased().contains(needle) ||
            $0.project.lowercased().contains(needle) ||
            $0.item.lowercased().contains(needle) ||
            $0.field.lowercased().contains(needle) ||
            $0.environment.lowercased().contains(needle) ||
            $0.tags.joined(separator: " ").lowercased().contains(needle)
        }
    }

    private var pinnedEntries: [AliasEntry] {
        guard model.pinsEnabled else { return [] }
        return matchingEntries.filter { model.pinnedIDs.contains($0.id) }
    }

    private var recentEntries: [AliasEntry] {
        let hidden = Set(pinnedEntries.map(\.id))
        return model.recent.filter { matchingEntries.contains($0) && !hidden.contains($0.id) }
    }

    private var allEntries: [AliasEntry] {
        let hidden = Set(pinnedEntries.map(\.id) + recentEntries.map(\.id))
        return matchingEntries.filter { !hidden.contains($0.id) }
    }

    private var selectedProject: Project? {
        model.projects.first(where: { $0.id == selectedProjectID }) ?? model.projects.first(where: { $0.isGlobal })
    }

    @ViewBuilder
    private var modalOverlay: some View {
        if let diagnostic = model.diagnostic {
            Color.black.opacity(0.5).ignoresSafeArea()
            DiagnosticSheet(model: model, diagnostic: diagnostic) { model.diagnostic = nil }
        } else if let entry = editing {
            Color.black.opacity(0.5).ignoresSafeArea()
            SecretEditSheet(model: model, entry: entry) { editing = nil }
        } else if showPasswordSheet {
            Color.black.opacity(0.5).ignoresSafeArea()
            MasterPasswordSheet(model: model) { showPasswordSheet = false }
        } else if showImportPreview {
            Color.black.opacity(0.5).ignoresSafeArea()
            ImportPreviewSheet(model: model) { showImportPreview = false }
        } else if let entry = copying {
            Color.black.opacity(0.5).ignoresSafeArea()
            SecretBarConfirmation(
                title: "Copy \(entry.alias)?",
                message: "This puts the secret value on the clipboard. Other apps may read it until the clipboard is replaced.",
                confirmTitle: "Copy value",
                destructive: false,
                onConfirm: {
                    model.copy(entry)
                    copying = nil
                },
                onCancel: { copying = nil }
            )
        } else if let entry = rotating {
            Color.black.opacity(0.5).ignoresSafeArea()
            SecretBarConfirmation(
                title: "Rotate \(entry.alias)?",
                message: "Generates a new password in Bitwarden and copies it to the clipboard.",
                confirmTitle: "Rotate and copy new value",
                destructive: true,
                onConfirm: {
                    model.rotate(entry)
                    rotating = nil
                },
                onCancel: { rotating = nil }
            )
        } else if confirmClearHistory {
            Color.black.opacity(0.5).ignoresSafeArea()
            SecretBarConfirmation(
                title: "Clear usage history?",
                message: "History contains aliases, actions, timestamps, and environments only. It never contains values.",
                confirmTitle: "Clear history",
                destructive: true,
                onConfirm: {
                    model.clearHistory()
                    confirmClearHistory = false
                },
                onCancel: { confirmClearHistory = false }
            )
        }
    }

    var body: some View {
        ZStack {
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
                tabBar
                if let flash = model.flash {
                    Text(flash)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            modalOverlay
        }
        .padding(10)
        .frame(width: 620, height: 700)
        .onAppear {
            model.start()
            selectDetectedProjectIfNeeded()
        }
        .onChange(of: model.detectedProjectID) { _, _ in selectDetectedProjectIfNeeded() }
        .fileImporter(
            isPresented: $showDotEnvImporter,
            allowedContentTypes: [.plainText, .data],
            allowsMultipleSelection: false
        ) { result in
            guard case let .success(urls) = result, let url = urls.first, let project = selectedProject else { return }
            model.prepareImport(url: url, project: project, environment: createEnvironment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "prod" : createEnvironment)
            showImportPreview = !model.importCandidates.isEmpty
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            StatusDot(state: model.state)
            VStack(alignment: .leading, spacing: 1) {
                Text(stateLabel).font(.headline)
                if let project = model.detectedProjectID,
                   let name = model.projects.first(where: { $0.id == project })?.name,
                   model.autoDetectProject {
                    Text("context: \(name)").font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if model.busy { ProgressView().controlSize(.small) }
            Button { model.refreshEverything() } label: { Image(systemName: "arrow.clockwise") }
                .help("Refresh secrets")
                .disabled(model.busy)
            if model.state == .unlocked {
                Button { model.lock() } label: { Image(systemName: "lock") }
                    .help("Lock the vault")
                    .disabled(model.busy)
            } else {
                Menu {
                    Button { model.unlockWithTouchID() } label: { Label("Unlock with Touch ID", systemImage: "touchid") }
                    Button { showPasswordSheet = true } label: { Label("Unlock with master password…", systemImage: "key") }
                } label: {
                    Label("Unlock", systemImage: "lock.open")
                }
                .help("Unlock the vault")
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
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Text("Create a secret").font(.title3.weight(.semibold))
                Text("Choose a scope and item type. Values are sent through stdin and never put in process arguments.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Scope", selection: $selectedProjectID) {
                    ForEach(model.projects) { project in
                        Text(project.isGlobal ? "Global" : project.name).tag(project.id)
                    }
                }
                Picker("Item type", selection: $createType) {
                    ForEach(SecretItemType.allCases) { type in Text(type.title).tag(type) }
                }
                .pickerStyle(.segmented)
                TextField("Environment (prod, dev, staging…)", text: $createEnvironment).textFieldStyle(.roundedBorder)
                TextField("Alias", text: $createAlias).textFieldStyle(.roundedBorder)
                TextField("Bitwarden item name (optional)", text: $createItemName).textFieldStyle(.roundedBorder)
                if createType == .secureNote {
                    TextEditor(text: $createValue)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 120, maxHeight: 180)
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.secondary.opacity(0.25)))
                    Text("Stored as the encrypted content of a Bitwarden Secure Note.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    SecureField("Value", text: $createValue).textFieldStyle(.roundedBorder)
                    TextEditor(text: $createNotes)
                        .font(.body)
                        .frame(minHeight: 70, maxHeight: 110)
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.secondary.opacity(0.25)))
                    Text("Notes are optional metadata and are separate from the secret value.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                TextField("Source URL (optional)", text: $createSource).textFieldStyle(.roundedBorder)
                TextField("Expires on YYYY-MM-DD (optional)", text: $createExpiresAt).textFieldStyle(.roundedBorder)
                TextField("Tags (comma-separated, optional)", text: $createTags).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Import .env…") { showDotEnvImporter = true }
                    Spacer()
                    Button("Create") {
                        guard let project = selectedProject else {
                            model.showError(title: "Cannot create secret", message: "No project scope is available.")
                            return
                        }
                        if model.create(alias: createAlias, project: project, value: createValue, itemName: createItemName, source: createSource, notes: createNotes, itemType: createType, expiresAt: createExpiresAt, environment: createEnvironment, tags: createTags) {
                            createAlias = ""
                            createItemName = ""
                            createValue = ""
                            createSource = ""
                            createNotes = ""
                            createExpiresAt = ""
                            createEnvironment = "prod"
                            createTags = ""
                            createType = .login
                            tab = .secrets
                        }
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.busy || model.state != .unlocked)
                }
            }
            .padding(.bottom, 8)
        }
    }

    private var secretsTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Search aliases, projects, items, or fields…", text: $query)
                .textFieldStyle(.roundedBorder)
            if model.problems.contains(where: { $0.value > 0 }) {
                Button { model.showHealthDiagnostics() } label: {
                    Label(healthSummary, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            }
            if !pinnedEntries.isEmpty {
                sectionTitle("PINNED")
                ForEach(pinnedEntries) { entryRow($0) }
            }
            if !recentEntries.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                sectionTitle("RECENT")
                ForEach(recentEntries) { entryRow($0) }
            }
            Divider()
            HStack {
                Text("ALL SECRETS").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Text("\(allEntries.count)").font(.caption2).foregroundStyle(.secondary)
            }
            if allEntries.isEmpty {
                Text(
                    model.state == .unlocked && !model.remoteValidationComplete
                        ? "Checking remote secrets…"
                        : model.entries.isEmpty
                            ? "No .secret.json projects found in ~/dev"
                            : "No remote secrets match"
                )
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 20)
                    .frame(maxWidth: .infinity)
            } else {
                Table(allEntries) {
                    TableColumn("Alias") { entry in
                        Text(entry.alias).font(.system(.body, design: .monospaced)).lineLimit(1)
                    }
                    TableColumn("Project") { entry in Text(entry.project).lineLimit(1) }
                    TableColumn("Env") { entry in Text(entry.environment).lineLimit(1) }
                    TableColumn("Item") { entry in Text(entry.item).lineLimit(1) }
                    TableColumn("Type") { entry in Text(entry.itemTypeTitle).lineLimit(1) }
                    TableColumn("Field") { entry in Text(entry.field).lineLimit(1) }
                    TableColumn("Tags") { entry in Text(entry.tags.joined(separator: ", ")).lineLimit(1) }
                    TableColumn("Health") { entry in
                        Text(model.health(for: entry)).foregroundStyle(healthColor(model.health(for: entry)))
                    }
                    TableColumn("Last used") { entry in Text(model.lastUsed(for: entry)).lineLimit(1) }
                    TableColumn("Actions") { entry in
                        HStack(spacing: 6) {
                            Button { copying = entry } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.borderless)
                                .disabled(model.busy || model.state != .unlocked)
                            if model.hasTOTP(entry) {
                                Button { model.copyTOTP(entry) } label: { Image(systemName: "number") }.buttonStyle(.borderless)
                                    .disabled(model.busy)
                            }
                            Button { editing = entry } label: { Image(systemName: "pencil") }.buttonStyle(.borderless)
                                .disabled(model.busy || model.state != .unlocked)
                            if model.pinsEnabled {
                                Button { model.togglePin(entry) } label: {
                                    Image(systemName: model.pinnedIDs.contains(entry.id) ? "pin.fill" : "pin")
                                }.buttonStyle(.borderless)
                            }
                        }
                    }
                }
                .frame(minHeight: 190)
            }
        }
    }

    private var settingsTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                settingsSection("Security") {
                    settingToggle("Hold to reveal values", isOn: Binding(get: { model.holdToReveal }, set: { model.holdToReveal = $0 }))
                    Text("Values appear only while holding a recent-row action. They are never copied or recorded.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                settingsSection("Clipboard") {
                    Picker("Clear copied values", selection: Binding(get: { model.clipboardClearSeconds }, set: { model.clipboardClearSeconds = $0 })) {
                        Text("Disabled").tag(0)
                        Text("30 seconds").tag(30)
                        Text("1 minute").tag(60)
                        Text("5 minutes").tag(300)
                    }
                    Text("SecretBar clears only if the clipboard has not changed since the copy.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                settingsSection("Appearance and shortcuts") {
                    settingToggle("Enable pinned favorites", isOn: Binding(get: { model.pinsEnabled }, set: { model.pinsEnabled = $0 }))
                    settingToggle("Enable keyboard shortcuts", isOn: Binding(get: { model.shortcutsEnabled }, set: { model.shortcutsEnabled = $0 }))
                    Text("Shortcuts apply while SecretBar is open: ⌘1 Create, ⌘2 My Secrets, ⌘3 Settings.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                settingsSection("Project discovery") {
                    settingToggle("Detect the active repository", isOn: Binding(get: { model.autoDetectProject }, set: { model.autoDetectProject = $0 }))
                    if let contextPath = model.contextPath, !contextPath.isEmpty {
                        Text("Context: \(contextPath)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    } else {
                        Text("Shell context has not reported a repository yet.").font(.caption).foregroundStyle(.secondary)
                    }
                    HStack {
                        Button("Open ~/dev") { openPath("\(homeDirectory())/dev") }
                        Button("Open global config") { openPath("\(homeDirectory())/.config/secret") }
                    }
                    ForEach(model.projects) { project in
                        HStack {
                            Text(project.isGlobal ? "Global" : project.name)
                            Spacer()
                            Button("Open") { openPath(project.configPath) }
                        }
                        .font(.caption)
                    }
                }
                settingsSection("Health") {
                    Stepper("Warn before expiry: \(model.expiryWarningDays) days", value: Binding(get: { model.expiryWarningDays }, set: { model.expiryWarningDays = $0 }), in: 1...365)
                    Button("Run health check") { model.refreshHealth() }
                    if !model.problemDetails.isEmpty {
                        Button("Show health details") { model.showHealthDiagnostics() }
                    }
                }
                settingsSection("Usage history") {
                    if model.history.isEmpty {
                        Text("No usage recorded yet.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(model.history.prefix(8))) { item in
                            HStack {
                                Text(item.command).font(.system(.caption, design: .monospaced)).frame(width: 52, alignment: .leading)
                                Text(item.target).font(.system(.caption, design: .monospaced)).lineLimit(1)
                                Spacer()
                                Text(formatHistoryDate(item.at)).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        Button("Clear usage history", role: .destructive) { confirmClearHistory = true }
                    }
                    Text("Only aliases, actions, timestamps, and environments are stored; values are never recorded.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                settingsSection("Diagnostics") {
                    HStack {
                        StatusDot(state: model.state)
                        Text(stateLabel)
                        Spacer()
                        Button("Refresh") { model.refreshEverything() }
                    }
                    if let sessionCreated = model.sessionCreated {
                        Text("Stored session: \(sessionCreated)").font(.caption).foregroundStyle(.secondary)
                    }
                    Button("Run secret doctor") { model.showHealthDiagnostics() }
                    if model.lastError != nil {
                        Button("Show last error") {
                            model.showError(title: "Last SecretBar error", message: model.lastError ?? "No error recorded.")
                        }
                    }
                }
                settingsSection("Application") {
                    Button("Quit SecretBar", role: .destructive) { NSApplication.shared.terminate(nil) }
                }
            }
        }
    }

    private func settingToggle(_ title: String, isOn: Binding<Bool>) -> some View {
        Toggle(title, isOn: isOn).toggleStyle(.switch)
    }

    private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.headline)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 4)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title).font(.caption2).foregroundStyle(.secondary)
    }

    private func entryRow(_ entry: AliasEntry) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(entry.alias).font(.system(.body, design: .monospaced)).lineLimit(1)
                    if model.pinsEnabled, model.pinnedIDs.contains(entry.id) { Image(systemName: "pin.fill").font(.caption2) }
                }
                Text("\(entry.project) · \(entry.environment) · \(entry.itemTypeTitle) · \(entry.field)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if model.holdToReveal, revealingID == entry.id {
                Text(revealedValue)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(1)
                    .textSelection(.disabled)
            } else {
                Text(model.health(for: entry)).font(.caption2).foregroundStyle(healthColor(model.health(for: entry)))
            }
            Button { copying = entry } label: { Image(systemName: "doc.on.doc") }
                .buttonStyle(.plain)
                .disabled(model.busy || model.state != .unlocked)
            if model.hasTOTP(entry) {
                Button { model.copyTOTP(entry) } label: { Image(systemName: "number") }
                    .buttonStyle(.plain)
                    .disabled(model.busy)
            }
            Button { editing = entry } label: { Image(systemName: "pencil") }
                .buttonStyle(.plain)
                .disabled(model.busy || model.state != .unlocked)
            if model.pinsEnabled {
                Button { model.togglePin(entry) } label: {
                    Image(systemName: model.pinnedIDs.contains(entry.id) ? "pin.fill" : "pin")
                }
                .buttonStyle(.plain)
            }
        }
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 0.35, maximumDistance: 24, pressing: { isPressing in
            guard model.holdToReveal else { return }
            if isPressing {
                revealingID = entry.id
                revealedValue = model.reveal(entry) ?? ""
            } else if revealingID == entry.id {
                revealingID = nil
                revealedValue = ""
            }
        }, perform: {})
        .contextMenu {
            if model.pinsEnabled { Button(model.pinnedIDs.contains(entry.id) ? "Unpin" : "Pin") { model.togglePin(entry) } }
            Button("Edit…") { editing = entry }
            if model.hasSource(entry) { Button("Open source URL") { model.openSource(entry) } }
            if model.hasTOTP(entry) { Button("Copy current TOTP") { model.copyTOTP(entry) } }
            Button("Rotate and copy new value") { rotating = entry }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var tabBar: some View {
        HStack(spacing: 0) {
            tabButton(.create, key: "1")
            tabButton(.secrets, key: "2")
            tabButton(.settings, key: "3")
        }
        .frame(maxWidth: .infinity)
        .background(Color.secondary.opacity(0.18), in: RoundedRectangle(cornerRadius: 9))
    }

    @ViewBuilder
    private func tabButton(_ section: SecretBarTab, key: KeyEquivalent) -> some View {
        let button = Button {
            tab = section
        } label: {
            Text(section.title)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
                .background(tab == section ? Color.accentColor.opacity(0.55) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        if model.shortcutsEnabled {
            button.keyboardShortcut(key, modifiers: [.command])
        } else {
            button
        }
    }

    private var healthSummary: String {
        let total = model.problems.values.filter { $0 > 0 }.reduce(0, +)
        return "\(total) health problem\(total == 1 ? "" : "s")"
    }

    private func healthColor(_ value: String) -> Color {
        switch value {
        case "OK": return .secondary
        case "Expires soon": return .orange
        default: return .red
        }
    }

    private func formatHistoryDate(_ value: String) -> String {
        guard let date = parseDate(value) else { return value }
        return formatDate(date)
    }

    private func selectDetectedProjectIfNeeded() {
        if let detected = model.detectedProjectID, model.autoDetectProject {
            selectedProjectID = detected
        } else if selectedProjectID.isEmpty {
            selectedProjectID = model.projects.first(where: { $0.isGlobal })?.id ?? model.projects.first?.id ?? ""
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
            SecretBarView().environmentObject(model)
        } label: {
            StatusIcon(state: model.state)
                .contextMenu {
                    Button("Refresh") { model.refreshEverything() }
                    if model.state == .unlocked {
                        Button("Lock vault") { model.lock() }
                    }
                    Divider()
                    Button("Quit SecretBar", role: .destructive) { NSApplication.shared.terminate(nil) }
                }
        }
        .menuBarExtraStyle(.window)
    }
}
