import Foundation
import Observation
import MWDATCore
import MWDATMockDevice
import Network

@Observable @MainActor
final class FollowUpModel {
  let display = DisplayViewModel(wearables: Wearables.shared)
  let wearables = WearablesViewModel(wearables: Wearables.shared)
  var backendURL = UserDefaults.standard.string(forKey: "backendURL") ?? ""
  var tokenInput = ""
  var recipientCandidate = ""
  var consent = false
  var source = "meta-speech"
  var hfpInputs: [(id: String, name: String)] = []
  var hfpUID = ""
  var notice = "First prove the glasses display and both speakers together. Live sending is disabled by default."
  var audioDiagnostic = "No capture started."
  var partial = ""
  var finalTranscript: [String] = []
  var envelope: Envelope? { didSet { snapshotReceivedHost = HFPCapture.hostSeconds } }
  var pageIndex = 0
  var counter = 0
  var launchDiagnostic = "Glasses launch not tested."
  var preview: (any MockDisplayKit)?
  var busy = false
  var localDisarmed = true
  var diagnosticRunning = false
  @ObservationIgnored private let api = BackendClient()
  @ObservationIgnored private let meta = MetaSpeechCapture()
  @ObservationIgnored private let hfp = HFPCapture()
  @ObservationIgnored private let launch = VoiceLaunch()
  @ObservationIgnored private let network = NWPathMonitor()
  @ObservationIgnored private var mock: (any MockGlasses)?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var captureNonce = UUID()
  @ObservationIgnored private var tail: Task<Void, Never>?
  @ObservationIgnored private var poll: Task<Void, Never>?
  @ObservationIgnored private var renderTask: Task<Void, Never>?
  @ObservationIgnored private var deviceState: AnyListenerToken?
  @ObservationIgnored private var sequence = 0
  @ObservationIgnored private var renderRevision = 0
  @ObservationIgnored private var lastRender = Date.distantPast
  @ObservationIgnored private var snapshotReceivedHost = 0.0

  init() {
    api.baseURL = URL(string: backendURL)
    hfp.onText = { [weak self] text in self?.receive(text) }
    hfp.onDiagnostic = { [weak self] value in self?.audioDiagnostic = value }
    hfp.onFailure = { [weak self] value in self?.interrupt(value) }
    network.pathUpdateHandler = { [weak self] path in
      if path.status != .satisfied { Task { @MainActor in self?.interrupt("Network unavailable. Cue discarded; no offline send queue.") } }
    }
    network.start(queue: DispatchQueue(label: "FollowUp.network"))
  }
  func saveSetup() {
    do {
      guard let url = URL(string: backendURL), url.scheme == "https", url.host != nil else { throw FollowUpFailure.message("Enter the deployed HTTPS backend URL.") }
      if !tokenInput.isEmpty { try DemoKeychain.save(tokenInput); tokenInput = "" }
      api.baseURL = url; UserDefaults.standard.set(backendURL, forKey: "backendURL")
      notice = "Backend URL saved. Device token is in Keychain; Gmail credentials stay server-side."
    } catch { notice = error.localizedDescription }
  }
  func listAudioInputs() async {
    do {
      let inputs = try await hfp.requestPermissionsAndListInputs()
      hfpInputs = inputs.map { ($0.uid, $0.portName) }
      notice = inputs.isEmpty ? "No HFP input. Pair the glasses as iPhone audio input and retry." : "Choose the literal glasses input below; verify its name and UID."
    } catch { notice = error.localizedDescription }
  }
  func prepareMock() async {
    guard envelope == nil, !diagnosticRunning else { notice = "Stop capture and the conversation before changing devices."; return }
    do {
      try await display.stopSession()
      MockDeviceKit.shared.enable()
      let device = try MockDeviceKit.shared.pairGlasses(model: .metaRayBanDisplay)
      device.powerOn(); device.unfold(); device.don(); mock = device; preview = device.services.display
      source = "simulation"; notice = "Mock device selected. This is injected simulation, not physical glasses/audio."
    } catch { notice = error.localizedDescription }
  }
  func usePhysicalGlasses() async {
    guard envelope == nil, !diagnosticRunning else { notice = "Stop capture and the conversation before changing devices."; return }
    try? await display.stopSession(); await MockDeviceKit.shared.disable()
    mock = nil; preview = nil; source = "meta-speech"
  }
  func connect(deviceID: String? = nil) async -> Bool {
    await display.attachToDisplay(deviceIdentifier: deviceID ?? mock?.deviceIdentifier)
    for _ in 0..<200 {
      if display.isConnected {
        observeDeviceSession(); await renderNow(); return true
      }
      if display.errorMessage != nil { notice = display.errorMessage!; return false }
      try? await Task.sleep(for: .milliseconds(50))
    }
    notice = "Display readiness timed out. Check registration, firmware and glasses app update."; return false
  }
  private func observeDeviceSession() {
    deviceState = display.activeSession?.statePublisher.listen { [weak self] state in
      if state == .paused || state == .stopping || state == .stopped {
        Task { @MainActor in self?.interrupt("Device session \(state). Resume explicitly; cue invalidated.") }
      }
    }
  }
  func enableVoiceLaunch() async {
    do {
      let ids = Wearables.shared.devices
      guard let id = mock?.deviceIdentifier ?? ids.first(where: { Wearables.shared.deviceForIdentifier($0)?.supportsDisplay() == true }) else {
        throw FollowUpFailure.message("No display device is available for the launch stream.")
      }
      try launch.start(deviceID: id, onLaunch: { [weak self] requestedID in
        guard let self else { return false }
        self.launchDiagnostic = "LaunchApp received. Cold launch and force-quit behavior are still unverified."
        return await self.connect(deviceID: requestedID)
      }, onError: { [weak self] message in self?.launchDiagnostic = message })
      launchDiagnostic = "Experimental launch listener enabled. Configure app name/approval in Wearables Developer Center; test launch separately."
    } catch { launchDiagnostic = error.localizedDescription }
  }
  func simulateLaunch() { _ = mock?.services.voiceInvocation.sendLaunchAppAction() }
  func simulateSpeech(_ text: String) {
    if diagnosticRunning { diagnosticText(CapturedText(text: text, final: true, epoch: "diagnostic", capturedMs: 0, confidence: nil)); return }
    guard let s = envelope?.session, s.source == "simulation" else { return }
    receive(CapturedText(text: text, final: true, epoch: s.epoch, capturedMs: max(hfp.elapsedMs, (s.arm?.minCaptureMs ?? 0) + 1), confidence: nil))
  }
  func begin() {
    guard !busy, envelope == nil, !diagnosticRunning, consent, display.isConnected else { notice = "Connect display, stop diagnostics, obtain consent, then Start on the glasses."; return }
    guard api.isConfigured else { notice = "Save the deployed HTTPS backend URL and its device token before starting the email conversation. Counter and capture diagnostics need no backend."; return }
    busy = true; generation = UUID(); captureNonce = UUID(); localDisarmed = true
    partial = ""; finalTranscript = []; pageIndex = 0; sequence = 0; hfp.sessionOrigin = HFPCapture.hostSeconds
    let nonce = generation
    enqueue { [weak self] in
      guard let self else { return }
      defer { self.busy = false }
      do {
        let e = try await self.api.request("sessions", body: ["consent": true, "source": self.source])
        guard self.generation == nonce else { return }
        self.envelope = e
        if !self.recipientCandidate.isEmpty {
          self.envelope = try await self.api.request("sessions/\(e.session.id)/recipient", body: ["recipient": self.recipientCandidate])
        }
        try await self.startCapture(); self.notice = "Listening started with consent. Review the complete message before arming."
        await self.renderNow()
      } catch { self.interrupt(error.localizedDescription) }
    }
    startPolling()
  }
  private func startCapture() async throws {
    guard let s = envelope?.session else { return }
    captureNonce = UUID(); let nonce = captureNonce
    if s.source == "meta-speech" {
      guard let session = display.activeSession else { throw FollowUpFailure.message("Display session not started.") }
      if try await Wearables.shared.checkPermissionStatus(.microphone) != .granted {
        guard try await Wearables.shared.requestPermission(.microphone) == .granted else {
          throw FollowUpFailure.message("Grant glasses microphone permission in Meta AI; capture is blocked.")
        }
      }
      try meta.start(session: session, epoch: s.epoch, onText: { [weak self] text in
        guard self?.captureNonce == nonce else { return }; self?.receive(text)
      }, diagnostic: { [weak self] value in self?.audioDiagnostic = value }, failure: { [weak self] value in self?.interrupt(value) })
    } else if s.source == "hfp" {
      hfp.selectedInputUID = hfpUID; try hfp.start(epoch: s.epoch, rotate: s.phase != "ARMED")
    } else { audioDiagnostic = "Injected transcript simulation. No microphone capture." }
  }
  private func receive(_ text: CapturedText) {
    if diagnosticRunning { diagnosticText(text); return }
    guard let e = envelope, text.epoch == e.session.epoch, !localDisarmed || e.session.phase == "DRAFTING" else { return }
    partial = text.final ? "" : text.text
    guard text.final else { return }
    if e.session.phase == "ARMED" {
      guard let arm = e.session.arm, network.currentPath.status == .satisfied,
        CueGuard.matches(text, phrase: e.cue, epoch: arm.epoch, boundary: arm.minCaptureMs) else { return }
      localDisarmed = true // consume locally once before any asynchronous request.
      UserDefaults.standard.set(e.session.id, forKey: "pendingDispatchID")
    } else if e.session.phase != "DRAFTING" { return }
    finalTranscript.append(text.text); sequence += 1
    let seq = sequence, nonce = generation, id = e.session.id, epoch = e.session.epoch
    let source = e.session.source
    enqueue { [weak self] in
      guard let self, self.generation == nonce, self.envelope?.session.epoch == epoch else { return }
      do {
        let response = try await self.api.request("sessions/\(id)/segment", body: ["id": UUID().uuidString, "sequence": seq, "epoch": epoch,
          "text": text.text, "final": true, "source": source, "capturedMs": text.capturedMs, "speaker": "unknown"])
        guard self.generation == nonce else { return }
        self.envelope = response
        if ["SENT","FAILED","UNKNOWN","DRY_RUN"].contains(response.session.phase) { self.stopCapture() }
        self.requestRender()
      } catch {
        // Never retry a verbal cue. Preserve session identity and query status separately.
        self.notice = "\(error.localizedDescription) Cue discarded; dispatch may be unknown. Use Check status."
        self.interrupt(self.notice)
      }
    }
  }
  func action(_ action: String) {
    if action == "counter" { counter += 1; requestRender(); return }
    if action == "start" { begin(); return }
    if action == "followup" { generateAndSend(); return }
    if action == "diag" { Task { await beginDiagnostic() }; return }
    if action == "diag-stop" { diagnosticRunning = false; stopCapture(); requestRender(); return }
    if action == "stop" { end(); return }
    if action == "draft-next" { pageIndex += 1; requestRender(); return }
    if action == "draft-back" { pageIndex = max(0, pageIndex - 1); requestRender(); return }
    if action == "pause" { interrupt("Paused deliberately; sending disarmed."); return }
    if action == "status" { checkStatus(); return }
    guard let s = envelope?.session else { return }
    let nonce = generation
    if action == "edit" || action == "recipient" { localDisarmed = true; stopCapture() }
    enqueue { [weak self] in
      guard let self, self.generation == nonce else { return }
      do {
        var body: [String: Any] = [:]
        let endpoint: String
        switch action {
        case "recipient": endpoint = "recipient"; body = ["recipient": self.recipientCandidate]; self.pageIndex = 0
        case "confirm": endpoint = "confirm"; body = ["recipient": s.recipient]
        case "next": endpoint = "page"; body = ["page": self.pageIndex]
        case "arm": endpoint = "arm"; body = ["captureMs": self.hfp.elapsedMs]; self.stopCapture()
        case "review": endpoint = "review"; self.pageIndex = 0
        case "edit": endpoint = "edit"; self.pageIndex = 0
        case "resume": endpoint = "resume"
        default: return
        }
        self.envelope = try await self.api.request("sessions/\(s.id)/\(endpoint)", body: body)
        guard self.generation == nonce else { return }
        if action == "next", let e = self.envelope { self.pageIndex = min(self.pageIndex + 1, e.pages.count - 1) }
        if ["resume", "edit", "recipient", "arm"].contains(action) {
          self.sequence = 0; try await self.startCapture(); self.localDisarmed = action != "arm"
        }
        await self.renderNow()
      } catch { self.notice = error.localizedDescription; self.localDisarmed = true; self.requestRender() }
    }
  }
  private func generateAndSend() {
    guard !busy, let e = envelope, e.session.phase == "DRAFTING", e.session.confirmed,
      e.oneTapEnabled == true, e.aiConfigured == true else { return }
    localDisarmed = true; stopCapture(); busy = true
    let nonce = generation, id = e.session.id
    UserDefaults.standard.set(id, forKey: "pendingDispatchID")
    notice = "Follow-up requested: generate and send without message review. Check status while the server writes the email."
    enqueue { [weak self] in
      guard let self else { return }; defer { self.busy = false }
      guard self.generation == nonce else { return }
      do {
        let response = try await self.api.request("sessions/\(id)/followup")
        guard self.generation == nonce else { return }; self.envelope = response
        self.requestRender()
      } catch {
        self.notice = "\(error.localizedDescription) Check this session’s status; no automatic retry."
        self.requestRender()
      }
    }
  }
  func interrupt(_ reason: String) {
    diagnosticRunning = false
    localDisarmed = true; stopCapture(); notice = reason
    guard let s = envelope?.session, !["SENT","SENDING","UNKNOWN","FAILED","DRY_RUN","ENDED","PAUSED"].contains(s.phase) else { return }
    let nonce = generation
    enqueue { [weak self] in
      guard let self, self.generation == nonce else { return }
      do { self.envelope = try await self.api.request("sessions/\(s.id)/pause"); await self.renderNow() }
      catch { self.notice = "Paused locally. Server unreachable; check the same session’s status before reset." }
    }
  }
  private func stopCapture() { captureNonce = UUID(); meta.stop(); hfp.stop() }
  func beginDiagnostic() async {
    guard consent, envelope == nil, display.isConnected, !diagnosticRunning else {
      notice = "Obtain both participants’ consent, connect the display and stop any conversation before capture diagnostics."; return
    }
    finalTranscript = []; partial = ""; diagnosticRunning = true; hfp.sessionOrigin = HFPCapture.hostSeconds
    do {
      if source == "meta-speech" {
        guard let session = display.activeSession else { throw FollowUpFailure.message("Device session unavailable.") }
        if try await Wearables.shared.checkPermissionStatus(.microphone) != .granted {
          guard try await Wearables.shared.requestPermission(.microphone) == .granted else { throw FollowUpFailure.message("Grant glasses microphone permission in Meta AI.") }
        }
        try meta.start(session: session, epoch: "diagnostic", onText: { [weak self] text in self?.diagnosticText(text) },
          diagnostic: { [weak self] value in self?.audioDiagnostic = value }, failure: { [weak self] value in self?.interrupt(value) })
      } else if source == "hfp" {
        hfp.selectedInputUID = hfpUID; try hfp.start(epoch: "diagnostic")
      } else { audioDiagnostic = "Injected diagnostic simulation; no actual capture." }
      notice = "Diagnostic only: alternate speaker sentences, click +1, then lock and pocket the iPhone with Xcode disconnected. No backend or email is used."
      await renderNow()
    } catch { diagnosticRunning = false; stopCapture(); notice = error.localizedDescription; requestRender() }
  }
  private func diagnosticText(_ text: CapturedText) {
    guard diagnosticRunning else { return }
    partial = text.final ? "" : text.text
    if text.final { finalTranscript.append(text.text); finalTranscript = Array(finalTranscript.suffix(50)) }
    requestRender()
  }
  func end() {
    diagnosticRunning = false
    localDisarmed = true; stopCapture(); poll?.cancel(); poll = nil; generation = UUID()
    partial = ""; finalTranscript = []; pageIndex = 0
    let id = envelope?.session.id; envelope = nil; recipientCandidate = ""; consent = false
    enqueue { [weak self] in
      guard let self else { return }
      if let id {
        do { _ = try await self.api.request("sessions/\(id)", method: "DELETE") }
        catch { self.notice = "Local transcript cleared. Server deletion unavailable; it expires in four hours." }
      }
      await self.renderNow()
    }
  }
  func checkStatus() {
    guard let s = envelope?.session else { return }; let nonce = generation
    enqueue { [weak self] in
      guard let self, self.generation == nonce else { return }
      do {
        let e = try await self.api.request("sessions/\(s.id)", method: "GET")
        guard self.generation == nonce else { return }
        let oldPhase = self.envelope?.session.phase; self.envelope = e
        if oldPhase == "GENERATING" && e.session.phase == "DRAFTING" {
          self.notice = e.session.outcome
          try await self.startCapture()
        }
        if (oldPhase == "ARMED" && e.session.phase != "ARMED") || ["SENT","FAILED","UNKNOWN","DRY_RUN"].contains(e.session.phase) {
          self.localDisarmed = true; self.stopCapture()
        }
        self.requestRender()
      } catch { self.notice = "Backend unavailable. Preserve session \(s.id); do not retry a cue or email." }
    }
  }
  func recoverLastDispatch() {
    guard envelope == nil, let id = UserDefaults.standard.string(forKey: "pendingDispatchID") else {
      notice = "End the current session before recovering the previous dispatch identity."; return
    }
    enqueue { [weak self] in
      guard let self else { return }
      do {
        self.envelope = try await self.api.request("sessions/\(id)", method: "GET")
        self.localDisarmed = true
        self.notice = "Recovered previous dispatch identity. Capture is stopped; no send was retried."
        await self.renderNow()
      } catch { self.notice = "Could not recover session \(id). Inspect server outbox and Gmail Sent privately; do not retry." }
    }
  }
  private func startPolling() {
    poll?.cancel()
    poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        guard !Task.isCancelled, let self else { return }
        if let phase = self.envelope?.session.phase, ["ARMED","GENERATING","SENDING"].contains(phase) { self.checkStatus() }
      }
    }
  }
  private func enqueue(_ operation: @escaping @MainActor () async -> Void) {
    let prior = tail
    tail = Task { await prior?.value; guard !Task.isCancelled else { return }; await operation() }
  }
  private func requestRender() {
    renderTask?.cancel()
    renderTask = Task { [weak self] in
      guard let self else { return }
      let wait = max(0, 1.2 - Date().timeIntervalSince(self.lastRender))
      try? await Task.sleep(for: .milliseconds(Int(wait * 1000)))
      guard !Task.isCancelled else { return }; await self.renderNow()
    }
  }
  func renderNow() async {
    guard display.isConnected else { return }
    guard !display.isSending else { requestRender(); return }
    var title = "Follow-up connected", detail = "Interactive counter: \(counter)\nStart only after conversation consent."
    var footer = preview == nil ? "Physical device session; capture unverified" : "MOCK DISPLAY — injected simulation"
    var actions = [GlassesAction(id: "counter", label: "+1"), GlassesAction(id: "diag", label: "Capture diagnostic"), GlassesAction(id: "start", label: "Start conversation")]
    if diagnosticRunning {
      title = "Listening · diagnostic"
      detail = "Counter: \(counter)\n\((partial.isEmpty ? finalTranscript.last ?? "Waiting for speech…" : "Partial: " + partial).suffix(200))"
      footer = "\(source) · Both speakers and locked phone unverified"
      actions = [GlassesAction(id: "counter", label: "+1"), GlassesAction(id: "diag-stop", label: "Stop capture")]
    }
    if let e = envelope {
      let s = e.session; title = "Follow-up · \(s.phase)"
      footer = "\(s.source) · \(s.confirmed ? "Recipient verified" : "Recipient unverified")"
      switch s.phase {
      case "DRAFTING":
        if !s.confirmed {
          detail = s.recipient.isEmpty ? "Recipient missing. Enter the literal address in phone setup (typed fallback)." : "Verify the complete address:\n\(s.recipient)"
          actions = s.recipient.isEmpty ? [] : [GlassesAction(id: "confirm", label: "Confirm recipient")]
        } else {
          let content = s.draft.map { "Subject: \($0.subject)\n\n\($0.body)" } ?? "Listening for finalized notes…"
          let chunks = stride(from: 0, to: content.count, by: 220).map { offset -> String in
            let start = content.index(content.startIndex, offsetBy: offset); let end = content.index(start, offsetBy: min(220, content.count - offset)); return String(content[start..<end])
          }
          pageIndex = min(pageIndex, max(0, chunks.count - 1)); detail = chunks.isEmpty ? "Listening…" : chunks[pageIndex]
          footer += " · Draft v\(s.draft?.version ?? 0) · \(pageIndex + 1)/\(chunks.count)"
          actions = [GlassesAction(id: "draft-back", label: "Previous"), GlassesAction(id: "draft-next", label: "Next"), GlassesAction(id: "review", label: "Review")]
          if e.oneTapEnabled == true, e.aiConfigured == true, s.draft != nil {
            actions.insert(GlassesAction(id: "followup", label: "Follow-up"), at: 0)
            footer += " · Follow-up generates and sends without review"
          }
        }
        actions += [GlassesAction(id: "pause", label: "Pause"), GlassesAction(id: "stop", label: "Stop")]
      case "GENERATING":
        detail = "Writing your email…\nTo: \(s.recipient)\nIt will send automatically when ready."
        footer += " · \(s.outcome)"
        actions = [GlassesAction(id: "status", label: "Check status"), GlassesAction(id: "pause", label: "Cancel before sending")]
      case "REVIEW":
        pageIndex = min(pageIndex, max(0, e.pages.count - 1)); detail = e.pages.isEmpty ? "No review content." : e.pages[pageIndex]
        footer += " · Frozen v\(s.approved?.version ?? 0) · Page \(pageIndex + 1)/\(e.pages.count)"
        actions = s.reviewPage == e.pages.count - 1 ? [GlassesAction(id: "arm", label: "Arm for 15 seconds")]
          : [GlassesAction(id: "next", label: pageIndex == e.pages.count - 1 ? "Review complete" : "Read · Next")]
        actions += [GlassesAction(id: "edit", label: "Return to editing"), GlassesAction(id: "stop", label: "Cancel")]
      case "ARMED":
        let remainingMs = (s.arm?.deadline ?? 0) - (e.serverNow ?? s.arm?.deadline ?? 0)
          - (e.transportElapsedMs ?? 0) - (HFPCapture.hostSeconds - snapshotReceivedHost) * 1000
        let remaining = max(0, Int((remainingMs / 1000).rounded(.down)))
        detail = localDisarmed ? "Cue consumed or capture unavailable. Check status."
          : "Ready · \(remaining) seconds\nSay the full phrase:\n\(e.cue)"
        actions = [GlassesAction(id: "edit", label: "Disarm"), GlassesAction(id: "stop", label: "Cancel")]
      case "PAUSED": detail = "Paused. Sending disarmed.\n\(notice)"; actions = [GlassesAction(id: "resume", label: "Resume"), GlassesAction(id: "stop", label: "Stop")]
      default:
        detail = s.outcome.isEmpty ? "Dispatch status pending. Preserve this session and check status." : s.outcome
        actions = [GlassesAction(id: "status", label: "Check status"), GlassesAction(id: "stop", label: "End / clear")]
      }
    }
    renderRevision += 1; let revision = renderRevision, nonce = generation
    let screen = GlassesScreen.make(title: title, detail: detail, footer: footer, actions: actions) { [weak self] action in
      Task { @MainActor in guard let self, self.generation == nonce, self.renderRevision == revision else { return }; self.action(action) }
    }
    await display.send(screen); lastRender = Date()
  }
}
