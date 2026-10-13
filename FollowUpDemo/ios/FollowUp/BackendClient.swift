import Foundation
import Security

enum DemoKeychain {
  static let service = "FollowUpDemo.backend"
  static func save(_ value: String) throws {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: "wearer-token"]
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = Data(value.utf8)
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw FollowUpFailure.message("Could not save the device access token.") }
  }
  static func read() -> String? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: "wearer-token",
      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var value: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
@MainActor
final class BackendClient {
  var baseURL: URL?
  var isConfigured: Bool {
    guard let baseURL, baseURL.scheme == "https", baseURL.host != nil,
      baseURL.user == nil, baseURL.password == nil, let token = DemoKeychain.read() else { return false }
    return token.count >= 32
  }
  func request(_ path: String, method: String = "POST", body: [String: Any] = [:]) async throws -> Envelope {
    guard let baseURL, baseURL.scheme == "https", baseURL.user == nil, baseURL.password == nil,
      let token = DemoKeychain.read(), token.count >= 32 else {
      throw FollowUpFailure.message("Set the deployed HTTPS backend URL and save its device token during setup.")
    }
    var req = URLRequest(url: baseURL.appendingPathComponent(path)); req.httpMethod = method; req.timeoutInterval = 8
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if method == "POST" { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
    let started = HFPCapture.hostSeconds
    let (data, response) = try await URLSession.shared.data(for: req)
    guard let http = response as? HTTPURLResponse else { throw FollowUpFailure.message("Backend unavailable. Cue discarded; check send status.") }
    guard (200..<300).contains(http.statusCode) else {
      let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
      throw FollowUpFailure.message(error?["error"] ?? "Backend request failed (\(http.statusCode)).")
    }
    var envelope = try JSONDecoder().decode(Envelope.self, from: data)
    envelope.transportElapsedMs = (HFPCapture.hostSeconds - started) * 1000
    return envelope
  }
}
