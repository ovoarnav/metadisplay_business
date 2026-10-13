import Foundation
import Testing
import MWDATCore
import MWDATDisplay
import MWDATMockDevice
@testable import DisplayAccess

@MainActor private final class Probe {
  var displayStarted = false
  var speechStarted = false
  var text: [CapturedText] = []
  var errors: [String] = []
  var clicks = 0
}
@Suite(.serialized) @MainActor
struct FollowUpTests {
  @Test func failedConfigurationNeverConstructsSDKDependentModel() {
    var modelCreations = 0
    let result = SDKStartup.start(configure: {
      throw FollowUpFailure.message("Keychain initialization failed")
    }, makeModel: { modelCreations += 1; return "model" })
    #expect(modelCreations == 0)
    if case let .blocked(message) = result {
      #expect(message == "Keychain initialization failed")
    } else {
      Issue.record("Configuration failure must block startup.")
    }
  }
  @Test func successfulConfigurationConstructsModelOnlyAfterConfigure() {
    var events: [String] = []
    let result = SDKStartup.start(configure: { events.append("configure") },
      makeModel: { events.append("model"); return "ready" })
    #expect(events == ["configure", "model"])
    if case let .ready(model) = result { #expect(model == "ready") }
    else { Issue.record("Successful configuration must allow startup.") }
  }
  @Test func cueRequiresFinalNewEpochAndFullPhrase() {
    let phrase = "I just realized I haven't shown you how good I am as a developer"
    let valid = CapturedText(text: phrase, final: true, epoch: "fresh", capturedMs: 11, confidence: nil)
    #expect(CueGuard.matches(valid, phrase: phrase, epoch: "fresh", boundary: 10))
    #expect(CueGuard.normalized("I just realized I haven’t shown you how good I am as a developer.") == CueGuard.normalized(phrase))
    #expect(!CueGuard.matches(valid, phrase: phrase, epoch: "old", boundary: 10))
    #expect(!CueGuard.matches(valid, phrase: phrase, epoch: "fresh", boundary: 11))
    #expect(!CueGuard.matches(CapturedText(text: phrase, final: false, epoch: "fresh", capturedMs: 11, confidence: nil), phrase: phrase, epoch: "fresh", boundary: 10))
    #expect(!CueGuard.matches(CapturedText(text: "I will say \(phrase) later", final: true, epoch: "fresh", capturedMs: 11, confidence: nil), phrase: phrase, epoch: "fresh", boundary: 10))
  }
  @Test func backendEnvelopeDecodesFrozenDraftAndDistinctDryRunOutcome() throws {
    let json = #"{"session":{"id":"id","phase":"DRY_RUN","recipient":"test@example.com","confirmed":true,"draft":null,"approved":{"version":1,"subject":"Hi","body":"Literal body","calendly":"https://calendly.com/arnavnambiar981/30min","evidenceIds":[]},"epoch":"epoch","source":"simulation","reviewPage":2,"arm":null,"outcome":"No email sent.","outboxId":"identity"},"pages":["Literal body"],"cue":"phrase"}"#
    let e = try JSONDecoder().decode(Envelope.self, from: Data(json.utf8))
    #expect(e.session.phase == "DRY_RUN")
    #expect(e.session.approved?.body == "Literal body")
    #expect(e.session.arm == nil)
  }
  @Test func officialMockDisplayAndSpeechShareOneSession() async throws {
    do { try Wearables.configure() }
    catch WearablesError.alreadyConfigured { }
    let kit = MockDeviceKit.shared
    kit.enable()
    let glasses = try kit.pairGlasses(model: .metaRayBanDisplay)
    glasses.powerOn(); glasses.unfold(); glasses.don()
    try await waitUntil { Wearables.shared.deviceForIdentifier(glasses.deviceIdentifier)?.linkState == .connected }
    let session = try Wearables.shared.createSession(deviceSelector: SpecificDeviceSelector(device: glasses.deviceIdentifier))
    try session.start()
    try await waitUntil { session.state == .started }
    let display = try session.addDisplay()
    let probe = Probe()
    let token = display.statePublisher.listen { state in Task { @MainActor in probe.displayStarted = state == .started } }
    display.start(); try await waitUntil { probe.displayStarted }
    let speech = MetaSpeechCapture()
    try speech.start(session: session, epoch: "test", onText: { probe.text.append($0) },
      diagnostic: { value in if value.contains("started") { probe.speechStarted = true } }, failure: { probe.errors.append($0) })
    try await waitUntil { glasses.services.speech.isListening }
    try await display.send(GlassesScreen.make(title: "Follow-up connected", detail: "Counter", footer: "MOCK", actions: [GlassesAction(id: "counter", label: "+1")]) { _ in Task { @MainActor in probe.clicks += 1 } })
    glasses.services.speech.simulateTranscription(text: "Participant one statement", isFinal: false, confidence: -1)
    glasses.services.speech.simulateTranscription(text: "Participant two statement", isFinal: true, confidence: -1)
    try await waitUntil { probe.text.count == 2 }
    #expect(probe.text[0].final == false)
    #expect(probe.text[1].final == true)
    #expect(probe.text[1].confidence == nil)
    #expect(probe.text[1].capturedMs == 0) // No timestamp in Meta SDK; never claim freshness.
    #expect(probe.displayStarted)
    speech.stop(); display.stop(); session.stop()
    withExtendedLifetime(token) {}
    await kit.disable()
  }
  private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async throws {
    for _ in 0..<100 { if condition() { return }; try await Task.sleep(for: .milliseconds(50)) }
    throw FollowUpFailure.message("Mock capability readiness timed out.")
  }
}
