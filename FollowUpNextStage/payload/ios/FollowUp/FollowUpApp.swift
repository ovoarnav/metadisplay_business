/* Adapted from Meta's official DisplayAccess sample. See META-LICENSE. */
import MWDATCore
import Foundation
import SwiftUI

@main
@MainActor
struct FollowUpApp: App {
  @State private var startup: SDKStartupResult<FollowUpModel>
  init() {
    let result = SDKStartup.start(configure: {
      do throws(WearablesError) {
        try Wearables.configure()
      } catch {
        // SwiftUI/test hosting may initialize the entry point more than once.
        if error != .alreadyConfigured {
          throw FollowUpFailure.message("Wearables.configure() failed: \(error.description) (code \(error.rawValue)).")
        }
      }
    }, makeModel: { FollowUpModel() })
    if case let .blocked(message) = result {
      // Only an SDK enum description/code is logged; no configuration secrets.
      NSLog("Follow-up SDK startup blocked: %@", message)
    }
    _startup = State(wrappedValue: result)
  }
  var body: some Scene {
    WindowGroup {
      switch startup {
      case .ready(let model):
        FollowUpView(model: model)
          .onOpenURL { url in
            guard URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
              .contains(where: { $0.name == "metaWearablesAction" }) == true else { return }
            Task {
              do { _ = try await Wearables.shared.handleUrl(url) }
              catch { model.notice = "Meta callback failed: \(error.localizedDescription)" }
            }
          }
      case .blocked(let message):
        NavigationStack {
          ScrollView {
            VStack(alignment: .leading, spacing: 16) {
              Text("Glasses SDK setup failed").font(.title2)
              Text("The SDK did not initialize. Recording and sending have not started.")
              Text(message).font(.system(.body, design: .monospaced)).textSelection(.enabled)
              #if targetEnvironment(simulator)
              Text("Rebuild with simulator ad-hoc signing enabled. Use the updated mac-check.sh script; CODE_SIGNING_ALLOWED=NO prevents the SDK’s keychain setup.")
              #else
              Text("Check Apple signing and the Meta SDK configuration. Share the error above so setup can be corrected.")
              #endif
            }.padding()
          }.navigationTitle("Follow-up")
        }
      }
    }
  }
}
