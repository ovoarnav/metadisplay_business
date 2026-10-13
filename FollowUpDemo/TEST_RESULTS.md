# Test results — October 12, 2026

**50 backend tests PASS; 0 failures. TypeScript build PASS. Compiled JavaScript server startup/health/authenticated session creation PASS.** Actual output is in `evidence/backend-tests.txt` and `evidence/backend-build.txt`.

The automated suite executed on Windows with Node v24.19.0. Provider interactions in that suite are injected fake HTTP responses. Simulation of text, source epochs and cue timing is controller simulation; no glasses, real audio, inbox, Google consent or booking was involved. Separately, one small real OpenAI API call using synthetic notes passed; its sanitized output is in `evidence/real-ai-test.txt`. That call did not contact Gmail or send email.

| Automated scenario | Result |
|---|---|
| Consent required / partials never notes or commands | PASS |
| Out-of-order draft inputs / duplicate callbacks | PASS |
| Recipient correction invalidates confirmation and review | PASS |
| Complete ordered review / exact frozen message / editing disarms | PASS |
| Unarmed cue, stale pre-arm audio, wrong epoch, partial cue | PASS |
| Substring cue / expired arm | PASS |
| Dry-run completion / repeated cue causes zero external sends | PASS |
| Hardware flag, selected HFP source, test recipient allowlist | PASS |
| Meta Speech with no capture timestamp cannot arm | PASS |
| Unset rehearsed sentence blocks arming | PASS |
| Arnav’s full reveal sentence / apostrophe typography / paraphrase rejection | PASS, injected text |
| Concurrent repeated cue dispatches once | PASS |
| Disconnect/interruption invalidates old audio epoch | PASS |
| Provider timeout -> durable UNKNOWN; no restart retry | PASS |
| Crash after committed SENDING -> UNKNOWN | PASS |
| Next conversation removes old prospect/callback authority | PASS |
| Transcript instructions cannot control recipient, URL or send | PASS |
| Session ownership / encryption at rest / four-hour expiry | PASS |
| MIME/header handling | PASS |
| Gmail token failure, dispatch timeout and API acceptance | PASS, fake transport |
| HTTP authentication, invalid JSON, health and absent public send route | PASS |
| Compiled JavaScript server startup and session request | PASS |
| Follow-up button: asynchronous generation without message review; repeated presses share one job | PASS, simulated AI |
| Meta Speech direct button dispatch; recipient and hardware/live gates | PASS, fake provider |
| Pause/correction/deletion/new conversation cancel a pending AI result | PASS |
| Old cancelled generation cannot erase tracking of a newer job | PASS |
| AI failure/invalid content produces no outbox or email | PASS |
| Restart during generation pauses without automatic dispatch | PASS |
| Button provider UNKNOWN remains durable and never automatically retries | PASS |
| Authenticated HTTP Follow-up progress and complete dry-run | PASS |
| Structured AI output, source quotes, fixed booking link, refusal/truncation/address/URL rejection | PASS, fake transport |
| Private provisioning: LF/CRLF, no printed secrets, no overwrite | PASS |

**Source verification PASS:** Swift grammar parsing for nine app files and one test file; OpenStep Xcode-project parsing and object-reference checks; URL scheme consistency and microphone, speech, Bluetooth, external-accessory and background-audio declarations. This verifies syntax/structure only, and cannot establish Swift SDK type compatibility or iOS behavior.

**Five native tests authored, not run here:** local final/epoch/full-phrase guard; immutable envelope decoding; official MockDeviceKit display and Meta Speech on the same session; failed SDK configuration never constructs the model; successful SDK configuration precedes model construction. Run with Xcode on the Mac using `scripts/mac-check.sh` and `SIMULATOR_ID`.

**Earlier simulator execution: FAIL at startup, user-reported.** The supplied log establishes that an original simulator binary was built/installed and launched, then SDK configuration failed and the app crashed on shared access. The simulator script incorrectly disabled code signing; it now uses ad-hoc signing, and startup safely displays configuration failures. The source/syntax checks passed, and the subsequent user-reported launch succeeded as recorded below. Native test execution is still unconfirmed. See `docs/SIMULATOR_STARTUP_FIX.md`.

**Subsequent simulator launch: PASS, user-reported.** After the fresh-start instructions, the user reported that the app runs in the simulator. This establishes a reported successful launch; it does not establish passing native tests, interactive mock display, physical iPhone installation, or glasses/audio behavior. The agent has not directly executed or observed this Mac build.

**Physical iPhone installation: PASS, user-reported.** The user subsequently reports installation on their iPhone 17 Pro Max and confirms their Ray-Ban Meta Display glasses are already paired to Meta AI on that phone. This establishes reported installation and pairing only. Follow-up registration, real display controls, audio capture and native test execution remain unconfirmed; the agent still has no Mac or hardware access.

**UNTESTED:** physical display controls, both-speaker intelligibility, background noise, locked/pocketed phone, interruptions, disconnect recovery, reading and arm UX, launch entry points, real Gmail acceptance, inbox delivery and booking. Record each physical case in `docs/HARDWARE_TEST.md`; a PASS requires observed evidence.

**Subsequent physical observation: user-reported text and transcript.** Arnav reports text on real glasses and transcript visible on the iPhone. No counter result, capture source, two-person test or locked-phone duration was supplied. The new one-tap native code has not been compiled, installed or tested on real glasses.

**Real OpenAI synthetic validation: PASS.** gpt-4.1-mini-2025-04-14 returned a validated structured email from synthetic finalized notes in 2,796 ms on one call, with the reviewed Calendly URL added by code. This was a billable model request. Earlier attempts did not reach the API because of network/private-file access and are not API pass claims. No Gmail call was made. Source-quote matching checks provenance; semantic faithfulness across real conversations remains unmeasured.

A real Railway Docker build and hosted synthetic dry-run passed on October 12, 2026 local time: public HTTPS health, bearer authentication, asynchronous generation, fixed Calendly URL and duplicate presses sharing one outbox. The second real OpenAI call completed this flow in 3,345 ms and made no Gmail call. See `evidence/hosted-dry-run.json`. The 34-test automated count is unchanged.

Four added installed-client protocol tests passed: explicit legacy Review opt-in, asynchronous compatible progress, repeated presses sharing a job/outbox, cancellation, recipient/note gates and terminal AI failure. Native source was inspected; the installed binary and real glasses have not exercised this compatibility flow yet. Provider calls in these cases are fake. See `evidence/legacy-backend-tests.txt`.

Four own-address-only live-gate tests passed: a physical-source button can use the explicit exception, other recipients and simulation are rejected, permission/allowlist are rechecked after AI, and unverified voice arming remains blocked. All provider calls in the 50-test suite are fake. A separate real Google refresh/account check passed without dispatch; see evidence/gmail-authorization.json.

The first real hosted Gmail dispatch returned SENT in Railway runtime logs at 2026-10-13T03:18:33.828301170Z; Arnav reports “SENT and email received.” This is provider acceptance plus user-reported inbox evidence, not independent body or hardware verification. Seven recipient tests and one context-agent test bring the latest fake-transport suite to 50 passing tests. They cover split chunks/start marker, explicit completion, correction, no partial/confirmed/manual override, literal confirmation, epoch resets and context provenance. See evidence/gmail-first-live-send.json and evidence/recipient-context-tests.txt. New spoken intake/context quality on hardware is pending.
