# Real-device gate and evidence sheet

Every row starts **UNTESTED**. Fill in PASS/FAIL only after performing it. Test partners must consent to transcription and any retained excerpts. Keep account tokens, email addresses and unrelated conversation content out of public evidence.

Record before testing:

```text
Date/time/timezone:
Tester and consented partner:
Mac model / macOS / Xcode / Swift:
iPhone model / iOS:
Glasses model / firmware / DAT glasses app:
Meta AI version / developer mode:
Apple team type and provisioning expiry:
Meta SDK: 1.0.1
Selected capture path:
HFP name + input UID + actual rate/channels (if used):
Backend deployment URL/version (later stages only):
Exact configured cue (later stages only):
```

## Gate 1: no backend or Gmail needed

1. Build/sign/install from the Mac. Pair and update the glasses, enable developer mode in Meta AI, launch Follow-up, register and approve the needed transport access.
2. Obtain both people’s consent. In phone setup toggle consent, select **Meta Speech**, connect the display. On the glasses confirm “Follow-up connected”; click **+1** five times and observe increments.
3. On the glasses select **Capture diagnostic**. Grant Meta’s microphone permission when prompted. Both people alternate distinctive sentences: “I manage Harbor Studio”; “We discussed missed follow-ups”; “Our next step is a discussion, not an agreed purchase.” Check exact meaning, names/negations and each speaker independently. No speaker identity is automatically assigned.
4. Keep the display active and click **+1** between sentences. Stop capture on the glasses. Repeat using **Selected glasses HFP**: grant iPhone microphone and Speech permissions, list inputs, explicitly select the glasses name/UID, then start diagnostic capture. Verify the actual route; a handset route is a failure, not a fallback.
5. For each path, unplug the phone from Xcode, end the debugger session, relaunch normally, start capture, lock the phone and place it in a pocket. Repeat the two-speaker sentences and counter clicks for at least five minutes. Unlock afterward to inspect source diagnostics and consented finalized text. Measure display update delay. iPhone locked means locked with the app already running; it does not mean force quit.
6. Repeat at conversational distance with background noise. Check whether the other speaker disappears or negation/names change. HFP suppression is documented; a wearer-only transcript fails the requested two-person gate.
7. While recording, introduce an incoming call/audio interruption; switch Bluetooth route; briefly disconnect/reconnect the glasses. Expect capture to stop/pause and arming to be invalidated. Resume deliberately. Check no silent microphone fallback or automatic old cue replay.

| Physical observation | Status | Evidence / measured delay / exact failure |
|---|---|---|
| Counter/display callback on real glasses | UNTESTED | |
| Meta Speech + interactive display simultaneously | UNTESTED | |
| HFP actual glasses input + interactive display | UNTESTED | |
| Wearer understood, quiet | UNTESTED | |
| Other speaker understood, quiet | UNTESTED | |
| Both speakers understood, noisy | UNTESTED | |
| Locked/pocketed phone, debugger detached, 5+ minutes | UNTESTED | |
| Interruption/route change/disconnect safely disarms | UNTESTED | |
| Deliberate recovery and next-session isolation | UNTESTED | |

If neither route captures both people usefully while displaying and locked, the original demo is **not proved feasible**. Stop that acceptance claim. Report source, firmware, transcript failures and conditions. Do not secretly enable a camera stream or phone microphone. A visibly consented alternate capture arrangement is a separate product decision requiring Arnav’s choice.

## Launch is a separate gate

Configure any required Voice Invocations capability approval and spoken app name in Wearables Developer Center. Enable the app’s experimental launch listener and use the exact Meta-supported entry point; do not invent a Hey Meta phrase. Receiving `LaunchApp` while the app is running proves only that case.

| Launch case | Status | Observed supported entry point / result |
|---|---|---|
| Select app on glasses app picker | UNTESTED | Verify whether native DAT demo is eligible and how registered. |
| Warm VoiceInvocation, no active display session | UNTESTED | |
| Warm VoiceInvocation, active display session | UNTESTED | |
| iPhone already locked | UNTESTED | |
| App not running / cold launch | UNTESTED | |
| App explicitly force quit | UNTESTED | |
| Phone-started session, then all operating controls on glasses | UNTESTED | |

## Current flow: one-tap AI Follow-up, without message review

Arnav explicitly requested generation and sending immediately after pressing Follow-up, without reviewing the generated message. This supersedes mandatory message review for the button route. Keep live sending false for initial testing. Install the new native patch, configure the private server OpenAI key and `ENABLE_ONE_TAP_FOLLOWUP=true`, save the backend URL/token on the phone, enter the literal recipient and obtain both participants' consent to transcription and AI drafting.

On glasses, choose Start conversation, confirm the literal address, alternate finalized statements, then choose Follow-up. Expect Writing your email, followed by DRY_RUN. Check the generated message, recipient and Calendly URL afterward. No Gmail call occurs in dry-run; the OpenAI generation itself is billable. Repeat button presses, cancel while writing, correct the recipient, and start a new conversation while an AI result is pending. Expect one job/outbox for repeated presses and no dispatch of cancelled/stale results. Test interruptions and lock-state operation separately.

After all physical capture/display/locked-phone checks pass, authorize Gmail and configure one consenting test recipient in the allowlist. Enabling live sending makes the Follow-up button generate and send automatically; no message-review step or spoken cue follows that gesture. Confirm Gmail acceptance, Sent and inbox separately. UNKNOWN still requires private Sent inspection and has no automatic retry.

The agent has verified one real OpenAI call with synthetic notes, not this hardware flow. Generation latency varies; one synthetic call took 2,796 ms. Text rendering and phone transcript are user-reported; two-person/locked-phone and new button interaction remain untested.

## Optional original route: draft, review and dry-run cue

After Gate 1, deploy the server over HTTPS with a persistent volume. The configured cue is **“I just realized I haven't shown you how good I am as a developer”**; verify that the glasses show this full sentence. Leave live sending false. Save the backend URL and device token in phone setup, enter a consenting test recipient’s literal address (typed fallback), and set consent before the conversation.

Start on glasses, alternate final statements, verify the full recipient address, and observe increasing draft versions. Read draft pages without losing your place during updates. Review every frozen page including literal subject, body and booking link. Correct a recipient or return to editing and verify the prior arm is invalidated. Enter review again, deliberately arm and say the complete configured cue within 15 seconds. Expect **DRY_RUN / no email sent**. Try the cue before arming, after timeout, inside a longer sentence, twice, and after interrupt/disconnect. None should create a second send record. Another speaker saying the complete phrase during a valid arm can trigger it; matching is not wearer authentication.

## One authorized Gmail test

Arnav must authorize a real test explicitly after hardware and dry-run evidence passes. Privately authorize Gmail and set one approved recipient in `TEST_RECIPIENT_ALLOWLIST`; only then enable `HARDWARE_CAPTURE_VERIFIED=true` and `ALLOW_LIVE_EMAIL=true` for the limited rehearsal. Review the exact message on the glasses and perform one cue. Check API acceptance, the Gmail Sent item, and the consenting recipient’s inbox separately. Measure cue-to-acceptance and inbox delay. A provider timeout means **UNKNOWN**; preserve the same session/outbox identity and inspect Sent before considering any new send. No automatic retry.

Open the configured Calendly page and confirm the intended public event. Booking a slot is a separate test that requires Arnav’s authorization; none is implied by including the link.
