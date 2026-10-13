# Install the AI Follow-up stage

The backend is deployed at **https://followup-backend-production.up.railway.app**. Its hosted synthetic generation test passed; live Gmail sending is disabled. The new native button has been written and syntax-checked on Windows, but has not been compiled or installed on your iPhone yet.

1. Download and unzip FollowUpNextStage.zip on the **Mac**. Close Xcode before applying it. This patch copies an explicit list of files and backs up affected files. It preserves the existing Xcode project/signing team, private backend `.env`, local data and phone Keychain settings.
2. In Mac Terminal run this command. Change the second path only if your working kit is elsewhere:

```bash
bash "$HOME/Downloads/FollowUpNextStage/apply.sh" \
  "$HOME/Downloads/metadisplay_business-main/FollowUpDemo"
```

The target is the folder containing `ios`, `backend` and `scripts`. If you used the FreshStart archive, use that extracted FollowUpDemo folder instead. The installer checks every supplied hash and path before replacing files. Backup location is printed under the target's `build-evidence/next-stage-backup.*`.

3. Open your **existing** `ios/DisplayAccess.xcodeproj`. Select the **DisplayAccess** scheme and your physical iPhone 17 Pro Max. Keep the signing team that already worked and press **Cmd-R**. The patch does not replace your project or require a new simulator UUID. For native build/test evidence, run `SIMULATOR_ID="your-existing-simulator-UUID" bash scripts/mac-check.sh` from the kit. New native source is not yet type-checked here.
4. On the phone, enter backend URL `https://followup-backend-production.up.railway.app`. In the Railway project's **Settings > Shared Variables > production**, reveal/copy only `APP_AUTH_TOKEN` privately into the phone's **Device access token** field. Tap **Save backend setup**. Server OpenAI/Gmail/encryption keys stay on Railway. The service Variables tab uses references to those shared values.
5. Rehearse in dry-run: get both participants' consent to transcription and AI drafting, start a conversation, confirm the full literal recipient, and capture finalized notes. Press **Follow-up** on the glasses. It generates the email and completes at **DRY_RUN**. Your chosen live workflow will send on that same gesture **without message review** after Gmail and the live gates are configured. Draft inspection afterward is available on the phone.
6. Complete the Google consent procedure in `payload/docs/BACKEND_SETUP.md` using Node 24+ on a private Mac. Create a Google Cloud **Web application** OAuth client for Gmail API with redirect `http://127.0.0.1:8765/callback`. Privately enter its client ID/secret and intended sender in `backend/.env`; use `node provision.mjs` only if that file is missing. From `backend`, run `node --env-file=.env src/oauth.ts`, open the printed Google URL yourself, and authorize the intended Gmail account. The refresh token is saved privately to `.data/gmail.env`; the helper sends no email. Add only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `GMAIL_SENDER` to the hosted service Variables tab. Never paste them into chat.

After useful two-person capture and a locked/pocketed five-minute run pass with the debugger disconnected, choose one consenting test recipient. Configure its literal address in `TEST_RECIPIENT_ALLOWLIST`, set `HARDWARE_CAPTURE_VERIFIED=true` only when supported by those results, and enable `ALLOW_LIVE_EMAIL=true` for that limited rehearsal. Check Gmail Sent and the recipient inbox, then disable live sending again. The optional spoken-cue route still requires review/arm and timestamped HFP; the Follow-up button accepts Meta Speech or HFP.

Source and review: https://github.com/ovoarnav/metadisplay_business/pull/1. The running backend is pinned to commit `376836282c1db390009ed96082cd8d4712b35198`; pushing later commits does not automatically deploy them. Railway project: https://railway.com/project/5e7b5c27-2d3e-4a57-a355-b137a962106d.

Verified: 34 backend tests, TypeScript compilation, one synthetic direct OpenAI call, a real Railway container build/start/volume mount, public HTTPS health and authenticated hosted generation/duplicate handling. No Gmail consent, Gmail send, new native build or new real-glasses button test has been performed by this agent. Your earlier report establishes text on glasses and transcript on the phone; both-speaker quality, phone-lock behavior and launch from glasses still need separate checks. Recovery across a replacement container is also untested.

Rotate the OpenAI key shared in chat and replace it privately in Railway's shared `OPENAI_API_KEY` when ready.
