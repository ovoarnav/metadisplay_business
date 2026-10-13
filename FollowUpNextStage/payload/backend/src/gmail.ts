import type { Sender, ProviderOutcome } from './core.ts';
import { email } from './core.ts';
export type GmailConfig = { clientId: string; clientSecret: string; refreshToken: string; sender: string };
export function mime(message: { recipient: string; subject: string; body: string; identity: string }, from: string): string {
  const headers = [
    `From: ${email(from)}`, `To: ${email(message.recipient)}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
    `Message-ID: <${Buffer.from(message.identity).toString('hex')}@followup.local>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'
  ];
  return [...headers, '', Buffer.from(message.body).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''].join('\r\n');
}
export class GmailSender implements Sender {
  config: GmailConfig; fetcher: typeof fetch;
  constructor(config: GmailConfig, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  async send(message: Parameters<Sender['send']>[0]): Promise<ProviderOutcome> {
    const c = this.config;
    if (!c.clientId || !c.clientSecret || !c.refreshToken || !c.sender) return { status: 'FAILED', detail: 'Gmail credentials are not configured; no dispatch attempted.' };
    let accessToken: string;
    try {
      const auth = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }) });
      if (!auth.ok) return { status: 'FAILED', detail: 'Gmail authorization failed before dispatch; reconnect the authorized account.' };
      const token = await auth.json() as { access_token?: string };
      if (!token.access_token) return { status: 'FAILED', detail: 'Gmail access token unavailable; no dispatch attempted.' };
      accessToken = token.access_token;
    } catch { return { status: 'FAILED', detail: 'Gmail authorization unavailable; no dispatch attempted.' }; }
    const raw = Buffer.from(mime(message, c.sender)).toString('base64url');
    try {
      const response = await this.fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', signal: AbortSignal.timeout(12_000),
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw })
      });
      if (response.ok) {
        const data = await response.json() as { id?: string };
        if (data.id) return { status: 'SENT', detail: 'Gmail accepted the email. Inbox arrival is unverified.', providerId: data.id };
      }
      // Gmail has no documented send idempotency key. Even a server error is ambiguous.
      return { status: 'UNKNOWN', detail: 'Gmail dispatch outcome unknown. Inspect Sent using the approved message; do not resend automatically.' };
    } catch { return { status: 'UNKNOWN', detail: 'Gmail dispatch timed out. Inspect Sent; do not resend automatically.' }; }
  }
}
