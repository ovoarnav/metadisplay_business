import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, Store, Fault, pages, CALENDLY, DEFAULT_SEND_CUE } from './core.ts';
import type { Segment, Source } from './core.ts';
import { GmailSender } from './gmail.ts';
import { OpenAIDrafter, DEFAULT_DRAFT_MODEL } from './drafting.ts';

export function makeServer(controller: Controller, token: string) {
  if (token.length < 32) throw new Error('Provision APP_AUTH_TOKEN with at least 32 random characters.');
  const owner = createHash('sha256').update(token).digest('hex');
  const buckets = new Map<string, { count: number; expires: number }>();
  const envelope = (session: ReturnType<Controller['read']>) => ({
    // The installed client polls SENDING, but does not know the new GENERATING phase.
    // Persist the real phase; this transport alias is limited to sessions using Review.
    session: session.legacyReviewFlow && session.phase === 'GENERATING'
      ? { ...session, phase: 'SENDING', outcome: 'Writing your email from captured notes. Gmail has not been contacted. End / clear cancels before dispatch.' }
      : session,
    pages: pages(session), cue: controller.config.cue,
    serverNow: controller.now(), oneTapEnabled: controller.config.oneTap === true, aiConfigured: controller.drafter != null,
    legacyReviewFollowup: controller.config.legacyReviewFollowup === true });
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status: number, value: unknown) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    if (req.url === '/health' && req.method === 'GET') { reply(200, { ok: true, provider: 'gmail', liveSending: controller.config.live,
      oneTapEnabled: controller.config.oneTap === true, aiConfigured: controller.drafter != null,
      hardwareCaptureVerified: controller.config.hardwareVerified,
      legacyReviewFollowup: controller.config.legacyReviewFollowup === true }); return; }
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (!timingSafeEqual(createHash('sha256').update(supplied).digest(), Buffer.from(owner, 'hex'))) { reply(401, { error: 'Unauthorized' }); return; }
    const bucketKey = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    for (const [key, value] of buckets) if (value.expires <= now) buckets.delete(key);
    const bucket = buckets.get(bucketKey) ?? { count: 0, expires: now + 60_000 }; buckets.set(bucketKey, bucket);
    if (++bucket.count > 180) { reply(429, { error: 'Rate limit exceeded' }); return; }
    try {
      let input: Record<string, unknown> = {};
      if (req.method === 'POST') {
        let bytes = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32_768) throw new Fault('Body too large', 413); chunks.push(chunk); }
        try { input = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new Fault('Invalid JSON', 400); }
        if (!input || Array.isArray(input) || typeof input !== 'object') throw new Fault('Object body required', 400);
      }
      if (req.url === '/sessions' && req.method === 'POST') {
        const s = controller.create(owner, input.consent === true, input.source as Source);
        reply(201, envelope(s)); return;
      }
      const match = /^\/sessions\/([a-f0-9-]+)(?:\/([a-z]+))?$/.exec(req.url ?? '');
      if (!match?.[1]) throw new Fault('Not found', 404);
      const id = match[1], action = match[2];
      if (req.method === 'POST' && action === 'followup') { reply(202, envelope(controller.followup(id, owner))); return; }
      if (req.method === 'POST' && action === 'review' && controller.config.legacyReviewFollowup === true) {
        reply(202, envelope(controller.followup(id, owner, true))); return;
      }
      const s = req.method === 'GET' && !action ? controller.read(id, owner)
        : req.method === 'DELETE' && !action ? controller.end(id, owner)
        : req.method === 'POST' && action === 'segment' ? await controller.segment(id, owner, input as unknown as Segment)
        : req.method === 'POST' && action ? controller.update(id, owner, action, input)
        : (() => { throw new Fault('Method not allowed', 405); })();
      reply(200, envelope(s));
    } catch (e) { reply(e instanceof Fault ? e.status : 500, { error: e instanceof Fault ? e.message : 'Internal error; inspect server privately.' }); }
  });
}
export function run() {
  const env = process.env;
  if (env.CALENDLY_URL && env.CALENDLY_URL !== CALENDLY) throw new Error('Configured Calendly link differs from the reviewed event.');
  if (!/^[a-fA-F0-9]{64}$/.test(env.DATA_ENCRYPTION_KEY ?? '')) throw new Error('Provision a 64-hex DATA_ENCRYPTION_KEY.');
  const path = env.DATABASE_PATH ?? '.data/followup.sqlite'; mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const store = new Store(path, Buffer.from(env.DATA_ENCRYPTION_KEY!, 'hex'));
  const controller = new Controller(store, { cue: env.SEND_CUE ?? DEFAULT_SEND_CUE, live: env.ALLOW_LIVE_EMAIL === 'true',
    allowlist: (env.TEST_RECIPIENT_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean), hardwareVerified: env.HARDWARE_CAPTURE_VERIFIED === 'true',
    oneTap: env.ENABLE_ONE_TAP_FOLLOWUP === 'true', legacyReviewFollowup: env.LEGACY_REVIEW_FOLLOWUP === 'true' },
    new GmailSender({ clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '', refreshToken: env.GOOGLE_REFRESH_TOKEN ?? '', sender: env.GMAIL_SENDER ?? '' }),
    Date.now, env.OPENAI_API_KEY ? new OpenAIDrafter(env.OPENAI_API_KEY, env.OPENAI_MODEL || DEFAULT_DRAFT_MODEL) : undefined);
  const server = makeServer(controller, env.APP_AUTH_TOKEN ?? '');
  server.listen(Number(env.PORT ?? 8080), env.HOST ?? '127.0.0.1', () => {
    const address = server.address(); const port = address && typeof address === 'object' ? address.port : 0;
    console.log(`Follow-up backend listening port=${port}. Live sending: ${controller.config.live}`);
  });
  const timer = setInterval(() => controller.purge(), 60_000); timer.unref();
  const stop = () => { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
