import Foundation
import Security

/// Where the session token is kept between launches.
nonisolated protocol TokenStore: Sendable {
    func read() -> String?
    func write(_ token: String) throws
    func delete()
    /// Deletes this app's tokens for every server, not just this store's.
    func deleteAll()
}

/// Keeps the session token in the Keychain, on this device only. It stays
/// readable after the first unlock, so background uploads can use it later.
nonisolated struct KeychainTokenStore: TokenStore {
    var service = "com.onmyhop.app.session"
    var account = "session"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(_ token: String) throws {
        delete()
        var item = query
        item[kSecValueData as String] = Data(token.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    func delete() {
        SecItemDelete(query as CFDictionary)
    }

    func deleteAll() {
        let everyAccount: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(everyAccount as CFDictionary)
    }
}
