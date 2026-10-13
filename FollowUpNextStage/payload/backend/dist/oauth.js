// One-time, private localhost authorization. Never used by the iOS app.
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const e = process.env;
if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET)
    throw new Error('Set Google OAuth web client ID/secret privately first.');
const redirect = e.GOOGLE_REDIRECT_URI ?? 'http://127.0.0.1:8765/callback';
const target = new URL(redirect);
if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:')
    throw new Error('Bootstrap callback must be local 127.0.0.1 HTTP.');
const state = randomBytes(32).toString('hex');
const verifier = randomBytes(32).toString('base64url');
const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
auth.search = new URLSearchParams({ client_id: e.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/gmail.send', access_type: 'offline', prompt: 'consent', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
let used = false;
const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
    }
    const u = new URL(req.url ?? '/', redirect);
    const supplied = createHash('sha256').update(u.searchParams.get('state') ?? '').digest();
    if (u.pathname !== target.pathname || used || !timingSafeEqual(supplied, createHash('sha256').update(state).digest()) || !u.searchParams.get('code')) {
        res.writeHead(400).end('Invalid callback.');
        return;
    }
    used = true;
    try {
        const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15_000), body: new URLSearchParams({
                client_id: e.GOOGLE_CLIENT_ID, client_secret: e.GOOGLE_CLIENT_SECRET, code: u.searchParams.get('code'), redirect_uri: redirect,
                grant_type: 'authorization_code', code_verifier: verifier
            }) });
        if (!response.ok)
            throw new Error('Exchange failed');
        const data = await response.json();
        if (!data.refresh_token || !data.access_token)
            throw new Error('Missing token');
        if (!data.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.send'))
            throw new Error('Gmail send consent not granted');
        const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${data.access_token}` } });
        if (!profileResponse.ok)
            throw new Error('Identity unavailable');
        const profile = await profileResponse.json();
        if (profile.email_verified !== true || !profile.email || (e.GMAIL_SENDER && profile.email.toLowerCase() !== e.GMAIL_SENDER.toLowerCase()))
            throw new Error('Wrong Gmail account');
        mkdirSync('.data', { recursive: true, mode: 0o700 });
        writeFileSync('.data/gmail.env', `GOOGLE_REFRESH_TOKEN=${data.refresh_token}\nGMAIL_SENDER=${profile.email}\n`, { mode: 0o600, flag: 'wx' });
        res.end('Gmail authorized. The token was saved privately in .data/gmail.env. Live sending remains disabled.');
        console.log('Authorization saved to .data/gmail.env; move it to the server secret store.');
    }
    catch {
        res.writeHead(400).end('Authorization could not be saved. Check account, consent, redirect, and whether .data/gmail.env already exists. No email sent.');
    }
    server.close();
});
server.listen(Number(target.port), '127.0.0.1', () => console.log('Open this URL in your own browser and authorize the intended Gmail account:\n' + auth.href));
setTimeout(() => server.close(), 5 * 60_000).unref();
