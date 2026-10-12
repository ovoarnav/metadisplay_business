import SwiftUI
import MWDATMockDevice
import MWDATCore

struct FollowUpView: View {
  @Bindable var model: FollowUpModel
  @State private var simulationText = "We discussed missed follow-ups and a possible next conversation."
  var body: some View {
    NavigationStack {
      Form {
        Section("Glasses display — no backend needed") {
          Button("Register with Meta AI") { Task { await model.wearables.connectGlasses() } }
          Button("Connect display / show counter") { Task { _ = await model.connect() } }
          Text(model.display.isConnected ? "Display capability started" : "Display not connected")
          if let error = model.display.errorMessage { Text(error).foregroundStyle(.red) }
          if model.wearables.showError { Text(model.wearables.errorMessage).foregroundStyle(.red) }
          Button("Update glasses firmware") { model.wearables.openFirmwareUpdate() }
          Button("Update DAT app on glasses") { model.wearables.openDATGlassesAppUpdate() }
          Text("The counter and capture diagnostic work before backend setup.")
        }
        Section("Setup before the conversation") {
          TextField("Deployed HTTPS backend URL", text: $model.backendURL).textInputAutocapitalization(.never).autocorrectionDisabled()
          SecureField("Device access token", text: $model.tokenInput)
          Button("Save backend setup") { model.saveSetup() }
          TextField("Recipient: literal full address (typed fallback)", text: $model.recipientCandidate)
            .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
          if model.envelope != nil { Button("Apply recipient correction — invalidates review and arm") { model.action("recipient") } }
          Toggle("Both participants consent to transcription and AI drafting", isOn: $model.consent)
          Picker("Capture path", selection: $model.source) {
            Text("Meta Speech · diagnostic/drafting").tag("meta-speech")
            Text("Selected glasses HFP · on-device ASR").tag("hfp")
            if model.preview != nil { Text("Injected simulation").tag("simulation") }
          }.disabled(model.envelope != nil || model.diagnosticRunning)
          if model.source == "hfp" {
            Button("Grant audio permissions / list HFP inputs") { Task { await model.listAudioInputs() } }
            Picker("Glasses input — verify name and UID", selection: $model.hfpUID) {
              Text("Select explicitly").tag("")
              ForEach(model.hfpInputs, id: \.id) { item in Text("\(item.name) · \(item.id)").tag(item.id) }
            }
          }
        }.disabled(model.busy)
        Section("Capture and session diagnostics") {
          Text(model.audioDiagnostic).font(.caption).textSelection(.enabled)
          Text(model.diagnosticRunning ? "Diagnostic capture active — no backend or email" : "Diagnostic capture stopped")
          Text(model.notice).textSelection(.enabled)
          Button("Recover previous dispatch identity (no resend)") { model.recoverLastDispatch() }
          if let s = model.envelope?.session {
            Text(model.envelope?.oneTapEnabled == true
              ? "Follow-up generates and sends immediately after recipient confirmation; message review is optional."
              : "Review, arm and the spoken cue are available; one-tap Follow-up is disabled on this backend.")
            if model.envelope?.oneTapEnabled == true, model.envelope?.aiConfigured != true {
              Text("Configure the private OpenAI API key on the backend to enable AI Follow-up.").foregroundStyle(.orange)
            }
            Text("\(s.phase) · \(s.id)").font(.caption).textSelection(.enabled)
            Button("Check same session’s dispatch status") { model.checkStatus() }
            Button("Stop and delete conversation data", role: .destructive) { model.end() }
          }
          if !model.partial.isEmpty { Text("Partial (never a command): \(model.partial)").foregroundStyle(.secondary) }
          ForEach(Array(model.finalTranscript.enumerated()), id: \.offset) { _, text in Text(text).font(.caption) }
        }
        Section("Separate glasses launch experiment") {
          Button("Enable experimental LaunchApp listener") { Task { await model.enableVoiceLaunch() } }
          Text(model.launchDiagnostic).font(.caption)
          Text("Launch from a glasses app picker, warm voice invocation, locked-phone launch, cold launch, and force-quit launch are separate untested cases.").font(.caption)
        }
        #if DEBUG
        Section("Developer simulation — no hardware claims") {
          Button("Enable Meta mock display") { Task { await model.prepareMock() } }
          Button("Return to physical glasses") { Task { await model.usePhysicalGlasses() } }
          if let preview = model.preview {
            MockPreview(display: preview).frame(height: 360)
            TextField("Injected finalized transcript", text: $simulationText)
            Button("Inject transcript") { model.simulateSpeech(simulationText) }
            Button("Inject configured cue") { model.simulateSpeech(model.envelope?.cue ?? "") }
            Button("Inject LaunchApp") { model.simulateLaunch() }
          }
        }
        #endif
      }.navigationTitle("Follow-up")
        .onChange(of: model.consent) { _, consent in if !consent { model.interrupt("Conversation consent withdrawn; capture stopped and sending disarmed.") } }
    }
  }
}
private struct MockPreview: UIViewRepresentable {
  let display: any MockDisplayKit
  func makeUIView(context: Context) -> UIView { display.createPreviewView() }
  func updateUIView(_ view: UIView, context: Context) {}
}
