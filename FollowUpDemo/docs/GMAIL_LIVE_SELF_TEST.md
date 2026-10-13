# First live Gmail test without a Mac

Google Cloud project `follow-up-gmail-demo` has Gmail API enabled and the Web OAuth client `Follow-up Backend Gmail`. Arnav authorized its send permission for `arnavnambiar981@gmail.com`. A real OAuth refresh and account-identity verification passed; see `../evidence/gmail-authorization.json`. Client secret and refresh token are private Railway service variables. The phone uses its existing device token; neither that token nor the database encryption key was changed.

The first live test is restricted to **arnavnambiar981@gmail.com as both sender and recipient**. `ALLOW_UNVERIFIED_SELF_TEST=true` provides an explicit own-address exception for the button path only. `HARDWARE_CAPTURE_VERIFIED=false` remains accurate. The recipient must also be allowlisted and confirmed, finalized notes must exist, and the session must identify a physical Meta Speech or HFP source. This source label is not proof of real capture. Simulation is blocked. Voice arming and other recipients still require the original hardware gates. The exception defaults to false in the distributed template.

Once the deployment's health reports `liveSending: true`, `gmailConfigured: true`, `liveSelfTestOnly: true`, and `hardwareCaptureVerified: false`:

1. End / clear any previous session and stop Capture diagnostic.
2. Keep the existing backend URL and device token. Set the recipient to `arnavnambiar981@gmail.com` and confirm transcription/AI consent.
3. Select Start follow-up and Confirm recipient on the glasses. Speak a fresh short conversation; check that finalized text appears in the email session on the phone.
4. Press **Review** once. This installed-app button now generates and sends the email immediately without message review, as requested. The server adds `https://calendly.com/arnavnambiar981/30min` in code.
5. Expect writing/sending progress followed by **SENT**. Inspect Gmail Sent and your inbox. SENT means Gmail accepted the message, not that inbox delivery was independently confirmed. A receipt identifies this as a self-test with hardware verification pending.

If the outcome is UNKNOWN, inspect Gmail Sent before taking any further action; the backend never retries an ambiguous dispatch automatically. Start a new conversation only for a deliberate new email. Live sending can be disabled on Railway without reinstalling the app by setting `ALLOW_LIVE_EMAIL=false` and redeploying when no send is in progress.

The verified Gmail grant contains send access and OpenID/email identity scopes, not mailbox read/delete access. Google testing-mode refresh tokens for Gmail can expire after seven days; reauthorization may be needed for a later rehearsal. See [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

Native compilation/installation of newer app source, simultaneous useful two-person capture, locked/pocketed-phone operation and launch from glasses remain separate acceptance checks. This backend change does not claim those checks passed.
