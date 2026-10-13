# Account and deployment boundaries

This demo is single-wearer. The one privately provisioned device token owns its sessions. It has no anonymous send endpoint. The token should be rotated after rehearsal. Node 24+, one replica, encrypted SQLite and a persistent disk are required; this is not a horizontally scaled production service.

## Current requested interaction and account actions

Arnav explicitly chose **generate and send immediately on Follow-up, without message review**. Literal recipient confirmation still happens before that button is offered. The server freezes finalized notes, calls its OpenAI drafting agent, validates the structured response and source quotes, adds the fixed Calendly link and sends the resulting message through Gmail once. One-tap can use physical Meta Speech or HFP. The original reviewed/armed voice-cue route remains optional and requires HFP timestamps.

Set `ENABLE_ONE_TAP_FOLLOWUP=true`, private `OPENAI_API_KEY`, and `OPENAI_MODEL=gpt-4.1-mini-2025-04-14`. Leave `ALLOW_LIVE_EMAIL=false` and `HARDWARE_CAPTURE_VERIFIED=false` until the physical checks and private Gmail setup are complete. Dry-run generation calls OpenAI and is billable; it does not call Gmail. A real synthetic API test passed in 2,796 ms, with no email sent. Source-quote checks do not prove every generated paraphrase is faithful; real conversation quality remains untested.

The Railway account is connected. A private **Follow-up Demo** project was created at `https://railway.com/project/5e7b5c27-2d3e-4a57-a355-b137a962106d`. One backend service and a 500 MB volume were staged. Arnav authorized deployment and storage of the supplied OpenAI key and newly generated device/encryption keys after automatic approval initially rejected the generated-key transfer. Authorized staging then succeeded. Keys are never included in this kit, a PR or build logs. The deployment result and URL are recorded in `STATUS.md`; a staged service is not a running server.

The source repository is `ovoarnav/metadisplay_business`. Repository-root deployment files use `Dockerfile.followup`, which copies only `FollowUpDemo/backend/package.json` and `FollowUpDemo/backend/src/`; root `railway.json` selects it and requires `/data`. This avoids depending on a custom service root for the initial deployment. The backend's own Dockerfile/railway.json remain available for standalone deployment. On Railway, `RAILWAY_RUN_UID=0` is the documented workaround for its root-owned volumes; no non-root runtime claim is made for that hosted configuration.

Arnav still performs these account/device actions:

1. **Gmail consent:** use the private Google Cloud/OAuth procedure below. The connected Gmail plugin is not the app's runtime credential source. Google authorization and real Gmail sending have not been tested here.
2. **Mac update:** apply the FollowUpNextStage patch to the existing kit, preserving Xcode signing, private `.env` and data. Rebuild/run the app on the physical iPhone using the same signing team. This agent has syntax-checked the new native source only.
3. **Phone configuration:** after deployment, use its HTTPS base URL and copy only `APP_AUTH_TOKEN` from Railway's private configuration to the phone's Device access token field. Save backend setup. OpenAI/Gmail/encryption secrets stay on Railway.
4. **Hardware check and dry-run:** obtain consent to transcription and AI drafting, confirm a literal recipient, capture both people with the phone locked and the debugger disconnected, then press Follow-up. Expect GENERATING then DRY_RUN. Inspect the generated recipient/body/Calendly afterward. Repeated presses must not create another job or outbox.
5. **One live Gmail test:** privately authorize the sender, allowlist one consenting recipient, and set the hardware flag only after the physical checks pass. Enable live sending for that limited rehearsal. Pressing Follow-up sends without a review screen. Check Gmail acceptance, Sent and inbox independently, then disable live sending again. UNKNOWN has no automatic retry.

Rotate the OpenAI key pasted into chat and replace it in Railway's private configuration after setup. Never copy server keys into the app bundle or source control.

## Private Gmail authorization — Arnav performs consent

1. In your Google Cloud project enable **Gmail API** under APIs & Services > Library. Under Google Auth platform configure Branding for Follow-up, choose an External audience for a personal Gmail account, and add the sender under Audience > Test users while the app is in Testing. Under Data Access add `https://www.googleapis.com/auth/gmail.send` plus `openid` and email identity. Under Clients create a **Web application** OAuth client. No email is sent by these steps.
2. Register the exact Authorized redirect URI `http://127.0.0.1:8765/callback`. On the Mac, with Node 24+ installed, open the project's backend folder and run `node provision.mjs` only if `.env` is missing. It creates private local configuration without overwriting an existing file. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GMAIL_SENDER` in `.env` privately; the intended sender is currently `arnavnambiar981@gmail.com` unless you choose another account. Local helper keys are independent of the hosted keys: transfer only the Gmail variables from this procedure, not a newly generated local device/encryption key over the existing hosted values.
3. On a private machine with this folder, run `node --env-file=.env src/oauth.ts` from `backend/`. Open its printed Google authorization URL yourself and approve the intended account. The helper requests `gmail.send` plus basic OpenID/email identity, uses a random state and PKCE challenge, validates the returned account, and stores the refresh token in **`.data/gmail.env`**, never in chat or stdout. The helper cannot send email. An existing credentials file is not overwritten.
4. Move `GOOGLE_REFRESH_TOKEN` and the returned `GMAIL_SENDER` into the backend’s private secret store. Keep the OAuth client secret there too. Protect the local files with owner-only permissions (on Windows, review the file’s Security permissions). Remove private temporary credential files when your deployment secret store is configured. A Google consent app in Testing can have time-limited refresh credentials; verify your project’s consent status before rehearsal.
5. Leave live flags false. Run the backend tests. Gmail authorization itself and a real provider request have not been run by Codex here.

Official references: [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending), [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Hosting — an authorized destination is needed

Railway was selected and deployment explicitly authorized. Use one instance and a persistent volume at `/data`. Do not use ephemeral/serverless storage for the outbox. Terminate HTTPS at the hosting platform/reverse proxy. Initial container/volume behavior still needs the deployment verification recorded in STATUS.md.

Provision:

```text
APP_AUTH_TOKEN             random 32+ characters, provision only to this iPhone
DATA_ENCRYPTION_KEY        persistent 32 bytes encoded as 64 hex characters
DATABASE_PATH             /data/followup.sqlite
CALENDLY_URL              https://calendly.com/arnavnambiar981/30min
SEND_CUE                  I just realized I haven't shown you how good I am as a developer
ALLOW_LIVE_EMAIL          false
HARDWARE_CAPTURE_VERIFIED false
TEST_RECIPIENT_ALLOWLIST  initially blank
GOOGLE_CLIENT_ID          private OAuth application value
GOOGLE_CLIENT_SECRET      private OAuth secret
GOOGLE_REFRESH_TOKEN      private token from user’s consent
GMAIL_SENDER              account verified by the consent helper
```

Keep the encryption key stable across restarts; losing it makes stored sessions unreadable. Back up the volume and key privately. `/health` returns only readiness/provider/live-mode information. Run `curl -f https://<your-host>/health`, then configure that URL in phone setup. Deploying the runtime means it continues without Codex or a laptop; no such deployment has happened yet.

## Recommended hosting: Railway

Arnav reports no existing hosting account. Railway is a recommendation, not an existing deployment or authorization to purchase a plan. Checked October 12, 2026: its [Hobby plan](https://docs.railway.com/pricing/plans) costs $5/month including $5 of resource usage; usage above that adds to the bill. Railway supplies [HTTPS domains](https://docs.railway.com/networking/public-networking) and [persistent volumes](https://docs.railway.com/volumes), which match this demo's requirements. Arnav performs account creation, GitHub access authorization and any billing selection.

1. Create a Railway account. For source deployment, connect the intended GitHub repository and create a service. Set the service's root directory to the actual backend folder containing `Dockerfile` and `src/` (`backend` if the repository starts at the kit root; `FollowUpDemo/backend` if the kit is nested in the repository). Use the existing Dockerfile. Do not upload `.env`, `.data`, credentials or conversation records to GitHub.
2. Attach a persistent volume at `/data`. Keep one replica. Railway mounts volumes as root, while the supplied Dockerfile uses the `node` user. For the unchanged kit, Railway's documented workaround is the service variable `RAILWAY_RUN_UID=0`; this runs the demo container as root. The generic Dockerfile remains non-root. Railway deployment and volume write permissions have not been tested here. See the permissions section in its volume guide.
3. On the Mac, with Node 24+ installed, run `node scripts/provision-local.mjs` from the kit root if `backend/.env` does not already exist. It creates the device token and encryption key privately. Preserve an existing file and key. Run `npm ci`, `npm run build` and `npm test` from `backend` to verify the copied backend.
4. In the Railway service's Variables tab, enter the generated `APP_AUTH_TOKEN` and `DATA_ENCRYPTION_KEY` privately. Add the following values. Do not import the local `HOST=127.0.0.1` or local database path into hosting.

```text
HOST=0.0.0.0
PORT=8080
DATABASE_PATH=/data/followup.sqlite
RAILWAY_RUN_UID=0
CALENDLY_URL=https://calendly.com/arnavnambiar981/30min
SEND_CUE=I just realized I haven't shown you how good I am as a developer
ALLOW_LIVE_EMAIL=false
HARDWARE_CAPTURE_VERIFIED=false
TEST_RECIPIENT_ALLOWLIST=
```

In the web Variables form, enter `SEND_CUE` without enclosing quotation marks; the local `.env` template uses quotes because it is a dotenv file. Gmail variables may remain empty for dry-run drafting and review. A healthy dry-run server does not establish Gmail authorization.

5. Deploy, inspect the deployment logs privately and verify successful database creation. In Settings > Networking > Public Networking, use Generate Domain with target port 8080. Set the health-check path to `/health`. Open `https://<generated-domain>/health`; expect `ok: true` and `liveSending: false`. This checks server startup, not inbox delivery or hardware capture.
6. In Follow-up on the iPhone, enter the generated HTTPS base URL (without `/health`) and the matching `APP_AUTH_TOKEN` as Device access token. Tap Save backend setup. Enter a consenting test recipient's full literal address and obtain both participants' transcription consent.
7. Rehearse with live sending disabled. Use Selected glasses HFP for the spoken arm/cue test. Confirm the full recipient, review all frozen pages including the Calendly link, arm deliberately and say the configured sentence within 15 seconds. Expect DRY_RUN and no Gmail call. Separately verify that the persisted session can be recovered after a server restart; do not deliberately restart during an armed or live dispatch.
8. Complete the private Gmail authorization procedure above when ready. Put its credentials in Railway's private Variables, never in iPhone fields. Real sending remains a later, explicitly authorized test after hardware and dry-run evidence passes.

No Railway account, repository connection, container build, persistent-volume test, hosted `/health` request or cloud deployment has been performed by this agent.

## Live enablement — a concrete authorized test remains

After recording physical display, two-person capture, locked/pocketed operation and the fresh cue boundary, obtain Arnav’s explicit approval for one named consenting test recipient. Add that literal address to the allowlist, set the hardware verification flag and enable live sending. A source other than `hfp` cannot live-arm. Disable live sending again after the rehearsal. Setting a flag is not evidence that a hardware test passed.

The connected Gmail plugin in Codex is not a runtime credential provider for this app. This implementation never asks Codex to send an email through a connector, retrieve account secrets or impersonate a different sending address.

## Retention and recovery

Raw audio is never saved by the application. Native diagnostics keep text in memory. Server transcripts/drafts/recipient and approved message are AES-256-GCM encrypted at rest, expire after four hours, and can be cleared with Stop/Delete. A minute-based purge removes expired content; an expired request also clears it. Minimal outbox metadata (session/identity hash, status, provider ID and timestamp) remains up to seven days, then is deleted. Protect host logs/backups with the same retention policy; the app cannot purge copies made outside it.

The server commits an immutable send record before provider I/O. Gmail does not offer a documented `messages.send` idempotency key. A timeout, server error or crash after `SENDING` becomes `UNKNOWN`; startup never redispatches it. A known pre-dispatch credential failure is `FAILED`. Reconciliation uses the saved identity/approved message and a private manual check of Gmail Sent; automated mailbox search is not implemented with the send-only scope. A Gmail message ID proves acceptance, not inbox delivery.
