# Spoken recipient and conversation context without a Mac

The first hosted Gmail self-test was accepted by Gmail, and Arnav reports the email arrived. Evidence is in `../evidence/gmail-first-live-send.json`. This update adds spoken-address assembly and better drafting context through the backend; the native app is unchanged.

## Try the spoken-address flow

1. End / clear the old session. Leave the phone's Recipient field **blank**, enable conversation/AI consent, and select physical Meta Speech or selected glasses HFP.
2. Start follow-up on the glasses. The initial screen says recipient missing; capture is running even though the confirmation button is not available yet.
3. Say **“My email is arnav nambiar nine eight one at gmail dot com. Email complete.”** The phrase may span several finalized transcript chunks. Pause until the full address `arnavnambiar981@gmail.com` appears on the glasses.
4. Verify every character before Confirm recipient. If it is wrong, repeat “My email is … Email complete” before confirming; the old candidate is hidden while the correction is assembled. A manually entered or already confirmed recipient is never replaced by conversation text.
5. After confirmation, discuss a concrete problem and a possible next step. Press Review once to generate and send. The own-address-only live gate remains in effect.

The formatter joins explicit spaces, `at`, `dot`/`period`, underscore, dash/hyphen, plus and spoken digits zero through nine. It requires a complete address and the explicit `Email complete` cue before presenting a spoken candidate. It does not guess missing letters, b/v mistakes, a domain or a person's name. If speech produces the wrong characters, use the existing phone field to enter/correct the exact literal address. No LLM selects or confirms a recipient.

`ENABLE_SPOKEN_RECIPIENT` defaults false in the kit and is explicitly enabled only on the hosted demo. Tests simulate the installed app's API and split text callbacks. Actual spelling accuracy on glasses needs the physical test above.

## Context and storage

There is already a server-side OpenAI drafting agent. Its updated single structured-output call first extracts discussion points, requests, agreed actions and uncertainties, then writes a specific follow-up. Notes are explicitly treated as consecutive chunks of one conversation. Each context point references source notes with verified exact quotes. Spelled contact setup is excluded from discussion content. Exact source quotes provide provenance; they do not mathematically prove the model's paraphrases are faithful. Check a real received email against the conversation.

The context brief is returned in the authenticated session's `draft.context` and stored with the draft. The old iPhone decoder ignores additional fields; it has no new context-inspection screen. The drafting input is capped at 36,000 characters, drawn from finalized notes; the saved brief records note count, characters used and whether this window was truncated. No raw audio is uploaded or saved by this implementation.

Finalized email-session text, recipient, draft and context are AES-256-GCM encrypted in SQLite at `/data/followup.sqlite` on Railway's persistent volume. The current session keeps the latest **100 finalized chunks**. End / clear or starting a new conversation clears the prior content; content also expires after four hours, with the periodic sweep running once per minute. Minimal session/outbox metadata is purged after seven days. Capture diagnostic is phone-only and never uploaded. This is temporary session storage, not a permanent CRM history or forensic-erasure guarantee for SQLite files/backups.

Recipient correction and Edit now rotate the capture epoch/reset the server chunk counter to match the installed app's restart. This prevents new conversation text after a correction from being silently rejected as an older chunk. Stale epochs, partials, recipient confirmation and duplicate-send gates remain enforced.
