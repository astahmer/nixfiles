import Foundation
import LocalAuthentication
import Security

// v1 of the passkey-style unlock: a session cached in the keychain, read only
// after a Touch ID/passcode prompt. `secret unlock --store` also writes here;
// `secret unlock --helper` reads it instead of asking for the master password
// again. v2 would replace the cached session with a biometric-protected user
// key via the Bitwarden SDK, making the unlock independent of session
// lifetime.

let service = "secret-cli"
let account = "biometric-session"

func store(_ session: String) -> Int32 {
    // Note: an unsigned CLI cannot create access-control items (errSec -34018);
    // the Touch ID prompt itself is the gate, the item stays in the user's
    // OS-encrypted login keychain.
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        kSecValueData as String: Data(session.utf8),
        kSecAttrLabel as String: "secret-cli biometric session",
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
        FileHandle.standardError.write(
            "secret: helper: keychain write failed (errSec \(status))\n".data(using: .utf8)!
        )
        return 1
    }
    FileHandle.standardError.write("secret: helper: biometric session stored\n".data(using: .utf8)!)
    return 0
}

func read() -> Int32 {
    let context = LAContext()
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
        FileHandle.standardError.write(
            "secret: helper: biometrics unavailable: \(authError?.localizedDescription ?? "unknown")\n".data(using: .utf8)!
        )
        return 1
    }
    let semaphore = DispatchSemaphore(value: 0)
    var authenticated = false
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock secrets with Touch ID") { ok, _ in
        authenticated = ok
        semaphore.signal()
    }
    semaphore.wait()
    guard authenticated else {
        FileHandle.standardError.write(
            "secret: helper: authentication cancelled or failed\n".data(using: .utf8)!
        )
        return 1
    }
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecReturnData as String: true,
        kSecUseAuthenticationContext as String: context,
        kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data, let session = String(data: data, encoding: .utf8) else {
        FileHandle.standardError.write(
            "secret: helper: no biometric session stored — run 'secret unlock --store' first\n".data(using: .utf8)!
        )
        return 1
    }
    print(session)
    return 0
}

let args = CommandLine.arguments
if args.count >= 3, args[1] == "store" {
    exit(store(args[2]))
}
exit(read())
