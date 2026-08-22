import Foundation
#if canImport(LocalAuthentication) && canImport(Security)
import LocalAuthentication
import Security
#endif

// Folded-in secret-unlock-helper: Touch ID-gated session caching, run
// in-process. A legacy `secret-unlock-helper` binary on PATH still wins
// (test fixtures and old installs); otherwise the keychain flow below runs
// directly, so no separate package is needed anymore.

let helperService = "secret-cli"
let helperAccount = "biometric-session"

func helperBinaryPath() -> String? {
    pathTo("secret-unlock-helper")
}

func helperSessionStore(_ token: String) -> Bool {
    if let helper = helperBinaryPath() {
        let r = runCommand(helper, ["store", token])
        if r.status == 0 { return true }
    }
    #if os(macOS)
    // Keep the biometric cache separate from the normal session. The explicit
    // access control makes the keychain enforce the biometric gate too; the
    // manual LAContext evaluation below remains as a useful fallback on Macs
    // where the existing item predates this ACL.
    var query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: helperService,
        kSecAttrAccount as String: helperAccount,
        kSecValueData as String: Data(token.utf8),
        kSecAttrLabel as String: "secret-cli biometric session",
    ]
    let identity: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: helperService,
        kSecAttrAccount as String: helperAccount,
    ]
    SecItemDelete(identity as CFDictionary)
    if let access = SecAccessControlCreateWithFlags(
        nil,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        .biometryAny,
        nil
    ) {
        query[kSecAttrAccessControl as String] = access
        if SecItemAdd(query as CFDictionary, nil) == errSecSuccess { return true }
        query.removeValue(forKey: kSecAttrAccessControl as String)
    }
    // A normal keychain item is still better than a plaintext file. Reads
    // continue to require LAContext authentication even on this fallback.
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    #else
    return false
    #endif
}

func helperClearSession() {
    #if os(macOS)
    SecItemDelete([
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: helperService,
        kSecAttrAccount as String: helperAccount,
    ] as CFDictionary)
    #endif
}

func helperSessionRead() -> String? {
    if let helper = helperBinaryPath() {
        let r = runCommand(helper, [])
        if r.status == 0 {
            let token = r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
            if !token.isEmpty { return token }
        }
    }
    #if os(macOS)
    if env("SECRET_NO_BIOMETRICS") != nil {
        return nil
    }
    let context = LAContext()
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
        return nil
    }
    let semaphore = DispatchSemaphore(value: 0)
    var authenticated = false
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock secrets with Touch ID") { granted, _ in
        authenticated = granted
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        return nil
    }
    guard authenticated else { return nil }
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: helperService,
        kSecAttrAccount as String: helperAccount,
        kSecReturnData as String: true,
        kSecUseAuthenticationContext as String: context,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
        return nil
    }
    return token
    #else
    return nil
    #endif
}

// Touch ID confirmation for dangerous mutations; falls back to a plain
// [y/N] prompt when biometrics are unavailable or disabled.
func touchIDAvailable() -> Bool {
    #if os(macOS)
    if env("SECRET_NO_BIOMETRICS") != nil { return false }
    return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    #else
    return false
    #endif
}

func confirmTouchID(reason: String) -> Bool {
    #if os(macOS)
    let context = LAContext()
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
        return false
    }
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
        granted = ok
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 30) == .timedOut {
        return false
    }
    return granted
    #else
    return false
    #endif
}
