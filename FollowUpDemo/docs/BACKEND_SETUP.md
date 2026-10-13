# Account and deployment boundaries

This demo is single-wearer. The one privately provisioned device token owns its sessions. It has no anonymous send endpoint. The token should be rotated after rehearsal. Node 24+, one replica, encrypted SQLite and a persistent disk are required; this is not a horizontally scaled production service.

## Current requested interaction and account actions

Arnav explicitly chose **generate and send immediately on Follow-up, without message review**. Literal recipient confirmation still happens before that button is offered. The server freezes finalized notes, calls its OpenAI drafting agent, validates the structured response and source quotes, adds the fixed Calendly link and sends the resulting message through Gmail once. One-tap can use physical Meta Speech or HFP. The original reviewed/armed voice-cue route remains optional and requires HFP timestamps.

Set `ENABLE_ONE_TAP_FOLLOWUP=true`, private `OPENAI_API_KEY`, and `OPENAI_MODEL=gpt-4.1-mini-2025-04-14`. Leave `ALLOW_LIVE_EMAIL=false` and `HARDWARE_CAPTURE_VERIFIED=false` until the physical checks and private Gmail setup are complete. Dry-run generation calls OpenAI and is billable; it does not call Gmail. A real synthetic API test passed in 2,796 ms, with no email sent. Source-quote checks do not prove every generated paraphrase is faithful; real conversation quality remains untested.

The Railway account is connected and Arnav authorized deployment and storage of the supplied OpenAI key and generated device/encryption keys. **The backend is deployed** at https://followup-backend-production.up.railway.app, with one service and a 500 MB persistent volume mounted at `/data`. The project is https://railway.com/project/5e7b5c27-2d3e-4a57-a355-b137a962106d. Source is pinned to commit `376836282c1db390009ed96082cd8d4712b35198` on `codex/followup-ai-send-20261012`. The repository became public at Arnav's request after credential-pattern scans of the source history and embedded ZIP; server keys stay private in Railway.

Railway built `Dockerfile.followup`, started the container, mounted the volume and passed health checks. A hosted synthetic test returned HTTP 202, completed AI drafting in 3,345 ms, included the configured Calendly link, and ended in DRY_RUN. Repeated presses returned the same outbox. Unauthenticated requests returned 401. Gmail was never called. This proves hosted generation and database writes, not Gmail authorization, native installation, hardware capture or persistence across a replacement container. Sanitized evidence is in `evidence/hosted-dry-run.json`.

Private values live in project shared variables and are linked into the service through reference variables. To configure the phone, copy `APP_AUTH_TOKEN` privately from **Project Settings > Shared Variables > production**. Only that device token goes to the phone. The service has explicit Dockerfile, healthcheck, no-sleep and restart settings; one replica remains configured. Legacy `railway.json` files are included for compatibility, but setting a custom Config as Code file is deprecated in current Railway. Do not add that setting to this service. Its current settings already deploy successfully. On Railway `RAILWAY_RUN_UID=0` handles its root-owned volume; the generic Dockerfile remains USER node.

Arnav still performs these account/device actions:

1. **Gmail consent:** use the private Google Cloud/OAuth procedure below. The connected Gmail plugin is not the app's runtime credential source. Google authorization and real Gmail sending have not been tested here.
2. **Mac update:** apply the FollowUpNextStage patch to the existing kit, preserving Xcode signing, private `.env` and data. Rebuild/run the app on the physical iPhone using the same signing team. This agent has syntax-checked the new native source only.
3. **Phone configuration:** use `https://followup-backend-production.up.railway.app` as the HTTPS base URL and copy only `APP_AUTH_TOKEN` from Railway's private configuration to the phone's Device access token field. Save backend setup. OpenAI/Gmail/encryption secrets stay on Railway.
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

## Hosted configuration and verification

The deployment and private configuration are already set up. Use the existing service, not a second project. Its HTTPS base URL is `https://followup-backend-production.up.railway.app` (without `/health`). Open `/health` and expect `ok: true`, `oneTapEnabled: true`, `aiConfigured: true`, `liveSending: false`, and `hardwareCaptureVerified: false`. Those flags do not verify Gmail or physical capture.

The fixed configuration includes `HOST=0.0.0.0`, `PORT=8080`, `DATABASE_PATH=/data/followup.sqlite`, `ENABLE_ONE_TAP_FOLLOWUP=true`, the pinned drafting model and configured Calendly link. `ALLOW_LIVE_EMAIL=false`, `HARDWARE_CAPTURE_VERIFIED=false`, and an empty test-recipient allowlist remain in place. Keep `DATA_ENCRYPTION_KEY` stable across deployments; replacing it makes existing records unreadable. Protect the key and volume backups privately.

For Gmail, add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `GMAIL_SENDER` **to this backend service's Variables tab** after the private consent procedure above. Do not replace the existing device/encryption keys with newly generated local keys. Shared variables require a service reference to take effect; these four Gmail values may instead be service variables directly.

Railway source is deliberately pinned: pushing later commits does not redeploy. To change the build, reconnect the intended source commit. A redeployment and recovery check has not yet been performed. Never restart or replace a container while a message is GENERATING, ARMED or SENDING. Check UNKNOWN against Gmail Sent privately; it never retries automatically.

Railway's [Hobby plan](https://docs.railway.com/pricing/plans) lists $5/month including $5 of usage, with excess resource usage billed separately. The actual account plan/billing selection was not changed here. [Reference variables](https://docs.railway.com/variables), [volumes](https://docs.railway.com/volumes) and [HTTPS domains](https://docs.railway.com/networking/public-networking) describe the platform settings used.

## Live enablement — a concrete authorized test remains

After recording physical display, useful two-person capture and locked/pocketed operation, choose one named consenting test recipient for the live rehearsal. Add that literal address to `TEST_RECIPIENT_ALLOWLIST`, set `HARDWARE_CAPTURE_VERIFIED=true` only when those checks pass, and set `ALLOW_LIVE_EMAIL=true` for that limited test. The Follow-up button sends the generated message without review, as Arnav requested. The optional spoken-cue route additionally requires the fresh HFP cue test; Meta Speech cannot voice-arm. Disable live sending again after rehearsal. A flag is not evidence that a hardware test passed.

The connected Gmail plugin in Codex is not a runtime credential provider for this app. This implementation never asks Codex to send an email through a connector, retrieve account secrets or impersonate a different sending address.

## Retention and recovery

Raw audio is never saved by the application. Native diagnostics keep text in memory. Server transcripts/drafts/recipient and approved message are AES-256-GCM encrypted at rest, expire after four hours, and can be cleared with Stop/Delete. A minute-based purge removes expired content; an expired request also clears it. Minimal outbox metadata (session/identity hash, status, provider ID and timestamp) remains up to seven days, then is deleted. Protect host logs/backups with the same retention policy; the app cannot purge copies made outside it.

The server commits an immutable send record before provider I/O. Gmail does not offer a documented `messages.send` idempotency key. A timeout, server error or crash after `SENDING` becomes `UNKNOWN`; startup never redispatches it. A known pre-dispatch credential failure is `FAILED`. Reconciliation uses the saved identity/approved message and a private manual check of Gmail Sent; automated mailbox search is not implemented with the send-only scope. A Gmail message ID proves acceptance, not inbox delivery.
