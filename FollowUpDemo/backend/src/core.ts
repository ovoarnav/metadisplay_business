import { randomUUID, createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { captureRecipient, recipientCandidate } from './recipient.ts';
import type { RecipientCapture } from './recipient.ts';

export const CALENDLY = 'https://calendly.com/arnavnambiar981/30min';
export const DEFAULT_SEND_CUE = "I just realized I haven't shown you how good I am as a developer";
export type Phase = 'IDLE' | 'DRAFTING' | 'GENERATING' | 'PAUSED' | 'REVIEW' | 'ARMED' | 'SENDING' | 'SENT' | 'FAILED' | 'UNKNOWN' | 'DRY_RUN' | 'ENDED';
export type Source = 'meta-speech' | 'hfp' | 'simulation';
export type Segment = { id: string; sequence: number; epoch: string; text: string; final: boolean; source: Source; capturedMs: number; speaker: 'unknown' | 'wearer' | 'prospect' };
export type Draft = { version: number; subject: string; body: string; calendly: string; evidenceIds: string[];
  context?: { points: { kind: string; text: string; noteIds: string[] }[]; noteCount: number; usedCharacters: number; truncated: boolean } };
export type Session = {
  id: string; owner: string; phase: Phase; recipient: string; confirmed: boolean;
  segments: Segment[]; draft: Draft | null; approved: (Draft & { recipient: string; digest: string }) | null;
  revision: number; epoch: string; lastSequence: number; source: Source;
  reviewPage: number; arm: { epoch: string; minCaptureMs: number; deadline: number } | null;
  created: number; expires: number; outcome: string; outboxId: string | null;
  legacyReviewFlow?: boolean;
  selfTestOnly?: boolean;
  recipientCapture?: RecipientCapture;
  recipientOrigin?: 'manual' | 'speech';
};
export type Config = { cue: string; live: boolean; allowlist: string[]; hardwareVerified: boolean; oneTap?: boolean; legacyReviewFollowup?: boolean; selfTestRecipient?: string; spokenRecipient?: boolean };
export type Drafter = { draft: (segments: Segment[], version: number) => Promise<Draft> };
export type ProviderOutcome = { status: 'SENT' | 'FAILED' | 'UNKNOWN'; detail: string; providerId?: string };
export type Sender = { send: (message: { recipient: string; subject: string; body: string; identity: string }) => Promise<ProviderOutcome> };
export class Fault extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const normalizeCue = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/[.,!?;:\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
export function email(s: unknown): string {
  if (typeof s !== 'string' || s.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(s)) throw new Fault('Enter the full literal email address; no speech punctuation inference.', 400);
  return s;
}
export function pages(s: Session): string[] {
  const d = s.approved ?? s.draft;
  if (!d) return [];
  // Explicit numbered review of every literal character, including recipient/link.
  const result = [`To: ${s.approved?.recipient ?? s.recipient}`, `Subject: ${d.subject}`];
  for (let i = 0; i < d.body.length; i += 220) result.push(d.body.slice(i, i + 220));
  return result;
}
export function groundedDraft(segments: Segment[], version: number): Draft {
  const chosen = segments.filter(s => s.final && s.text.trim()).slice(-3);
  // Deterministic, quoted evidence. No model, inferred identities, or invented promises.
  const facts = chosen.map(s => `• ${s.speaker === 'unknown' ? 'Speaker unverified' : s.speaker} excerpt: “${s.text.slice(0, 240)}${s.text.length > 240 ? '…' : ''}”`).join('\n');
  return {
    version, subject: 'Following up on our conversation',
    body: `Hi,\n\nThanks for the conversation. Here are the points captured for your review:\n\n${facts || 'No finalized conversation notes yet.'}\n\nIf you would like to continue the discussion, choose a time here:\n${CALENDLY}\n\nBest,\nArnav`,
    calendly: CALENDLY, evidenceIds: chosen.map(s => s.id)
  };
}

export class Store {
  db: DatabaseSync;
  key: Buffer;
  constructor(path: string, key: Buffer) {
    if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must contain 32 bytes');
    this.key = key; this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, digest TEXT NOT NULL,
        status TEXT NOT NULL, provider_id TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(owner TEXT PRIMARY KEY, session_id TEXT NOT NULL);`);
    // A crash after dispatch is ambiguous. NEVER retry a Gmail send automatically.
    this.db.exec("UPDATE outbox SET status='UNKNOWN' WHERE status='SENDING'");
    for (const row of this.db.prepare('SELECT id,owner,data FROM sessions').all()) {
      const s = this.open(String(row.data)) as Session;
      const ob = s.outboxId ? this.outbox(s.outboxId) : null;
      if (ob) { s.phase = ob.status as Phase; s.arm = null; }
      else if (s.phase !== 'ENDED') { s.phase = 'PAUSED'; s.arm = null; s.epoch = randomUUID(); }
      this.put(s);
    }
  }
  seal(value: unknown): string {
    const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString('base64');
  }
  open(value: string): unknown {
    const bytes = Buffer.from(value, 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    d.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString());
  }
  get(id: string, owner: string): Session {
    const row = this.db.prepare('SELECT data FROM sessions WHERE id=? AND owner=?').get(id, owner);
    if (!row) throw new Fault('Session not found', 404);
    return this.open(String(row.data)) as Session;
  }
  put(s: Session) { this.db.prepare('INSERT INTO sessions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(s.id, s.owner, this.seal(s)); }
  transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = body(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  outbox(id: string) { return this.db.prepare('SELECT * FROM outbox WHERE id=?').get(id); }
  close() { this.db.close(); }
}

export class Controller {
  store: Store; config: Config; sender: Sender; now: () => number;
  drafter?: Drafter;
  private followupJobs = new Map<string, Promise<Session>>();
  constructor(store: Store, config: Config, sender: Sender, now = Date.now, drafter?: Drafter) {
    this.store = store; this.config = config; this.sender = sender; this.now = now; this.drafter = drafter;
  }
  read(id: string, owner: string): Session {
    const s = this.store.get(id, owner);
    if (s.arm && this.now() >= s.arm.deadline) { s.phase = 'REVIEW'; s.arm = null; this.store.put(s); }
    if (this.now() >= s.expires && s.phase !== 'ENDED') return this.end(id, owner);
    return s;
  }
  create(owner: string, consent: boolean, source: Source): Session {
    if (consent !== true) throw new Fault('Obtain conversation consent and explicitly Start.', 400);
    if (!['meta-speech', 'hfp', 'simulation'].includes(source)) throw new Fault('Unknown audio source', 400);
    return this.store.transaction(() => {
      const old = this.store.db.prepare('SELECT session_id FROM leases WHERE owner=?').get(owner);
      if (old) {
        const previous = this.store.get(String(old.session_id), owner);
        previous.arm = null; previous.phase = previous.outboxId ? previous.phase : 'ENDED';
        previous.segments = []; previous.draft = null; previous.approved = null; previous.recipient = ''; previous.confirmed = false;
        previous.recipientCapture = undefined;
        previous.recipientOrigin = undefined;
        this.store.put(previous);
      }
      const s: Session = { id: randomUUID(), owner, phase: 'DRAFTING', recipient: '', confirmed: false, segments: [], draft: null,
        approved: null, revision: 0, epoch: randomUUID(), lastSequence: 0, source, reviewPage: -1, arm: null,
        created: this.now(), expires: this.now() + 4 * 3600_000, outcome: '', outboxId: null };
      this.store.put(s);
      this.store.db.prepare('INSERT INTO leases VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET session_id=excluded.session_id').run(owner, s.id);
      return s;
    });
  }
  update(id: string, owner: string, action: string, input: Record<string, unknown>): Session {
    return this.store.transaction(() => {
      const s = this.read(id, owner);
      if (['SENDING','SENT','UNKNOWN','DRY_RUN','FAILED','ENDED'].includes(s.phase)) throw new Fault('Terminal/ambiguous send state; reset for a new conversation.');
      if (s.phase === 'GENERATING' && !['pause','recipient','edit'].includes(action)) throw new Fault('Email generation is in progress; pause or cancel before changing the session.');
      switch (action) {
        case 'recipient':
          s.recipient = email(recipientCandidate(input.recipient) ?? input.recipient);
          s.recipientOrigin = 'manual';
          s.confirmed = false; s.approved = null; s.arm = null; s.phase = 'DRAFTING'; s.reviewPage = -1;
          s.epoch = randomUUID(); s.lastSequence = 0; s.recipientCapture = undefined; break;
        case 'confirm':
          if (input.recipient !== s.recipient || !s.recipient) throw new Fault('Confirmation must match the literal address.');
          s.confirmed = true; break;
        case 'review': {
          if (!s.confirmed || !s.draft || !s.segments.length) throw new Fault('Confirm recipient and obtain a finalized draft first.');
          if (s.phase !== 'DRAFTING') throw new Fault('Return to editing before starting a new review.');
          const msg = { ...s.draft, recipient: s.recipient };
          s.approved = { ...msg, digest: hash(JSON.stringify(msg)) }; s.phase = 'REVIEW'; s.arm = null; s.reviewPage = -1; break;
        }
        case 'page':
          if (s.phase !== 'REVIEW' || input.page !== s.reviewPage + 1 || Number(input.page) >= pages(s).length) throw new Fault('Review each page in order.');
          s.reviewPage = Number(input.page); break;
        case 'edit':
          s.arm = null; s.approved = null; s.phase = 'DRAFTING'; s.reviewPage = -1;
          s.epoch = randomUUID(); s.lastSequence = 0; s.recipientCapture = undefined; break;
        case 'arm':
          if (s.phase !== 'REVIEW' || !s.approved || s.reviewPage !== pages(s).length - 1) throw new Fault('Review the exact complete message before arming.');
          if (!this.config.cue.trim()) throw new Fault('Configure Arnav’s rehearsed full cue before arming.');
          if (this.config.live && (!this.config.hardwareVerified || s.source !== 'hfp')) throw new Fault('Live cue requires verified HFP capture + display + locked-phone evidence.');
          if (s.source === 'meta-speech') throw new Fault('Meta Speech lacks capture timestamps; use HFP or injected simulation for cue testing.');
          if (!Number.isFinite(input.captureMs) || Number(input.captureMs) < 0) throw new Fault('Missing capture boundary', 400);
          s.epoch = randomUUID(); s.lastSequence = 0;
          s.arm = { epoch: s.epoch, minCaptureMs: Number(input.captureMs), deadline: this.now() + 15_000 }; s.phase = 'ARMED'; break;
        case 'pause':
          s.arm = null; s.approved = null; s.phase = 'PAUSED'; s.epoch = randomUUID(); s.lastSequence = 0; s.recipientCapture = undefined; break;
        case 'resume':
          if (s.phase !== 'PAUSED') throw new Fault('Only resume a paused session.');
          s.phase = 'DRAFTING'; s.epoch = randomUUID(); s.lastSequence = 0; break;
        default: throw new Fault('Unknown action', 400);
      }
      this.store.put(s); return s;
    });
  }
  async segment(id: string, owner: string, input: Segment): Promise<Session> {
    let pending: { identity: string; recipient: string; subject: string; body: string } | null = null;
    this.store.transaction(() => {
      const s = this.read(id, owner);
      if (!input || typeof input.text !== 'string' || input.text.length > 4000 || !Number.isInteger(input.sequence) || !Number.isFinite(input.capturedMs) || typeof input.id !== 'string') throw new Fault('Invalid transcript segment', 400);
      if (input.epoch !== s.epoch || input.source !== s.source || input.sequence <= s.lastSequence || ['GENERATING','PAUSED','ENDED','SENDING','SENT','UNKNOWN','DRY_RUN','FAILED'].includes(s.phase)) return;
      if (input.final !== true) return; // Partials are local UI only; never commands/notes.
      s.lastSequence = input.sequence;
      if (s.phase === 'ARMED' && s.arm && s.approved) {
        const matched = normalizeCue(input.text) === normalizeCue(this.config.cue);
        if (matched && input.capturedMs > s.arm.minCaptureMs && this.now() < s.arm.deadline && input.epoch === s.arm.epoch) {
          if (this.config.live && (!this.config.hardwareVerified || input.source !== 'hfp' || !this.config.allowlist.includes(s.approved.recipient))) throw new Fault('Live send blocked: hardware verification or recipient allowlist missing.');
          const identity = `${s.id}:${s.approved.digest}`;
          const state = this.config.live ? 'SENDING' : 'DRY_RUN';
          this.store.db.prepare('INSERT INTO outbox(id,session_id,digest,status,created) VALUES (?,?,?,?,?)').run(identity, s.id, s.approved.digest, state, this.now());
          s.outboxId = identity; s.phase = state; s.arm = null;
          if (this.config.live) pending = { identity, recipient: s.approved.recipient, subject: s.approved.subject, body: s.approved.body };
          else s.outcome = 'Simulation completed. No email was sent.';
        }
      } else if (s.phase === 'DRAFTING' && !s.segments.some(x => x.id === input.id)) {
        s.segments.push({ ...input, speaker: ['wearer','prospect'].includes(input.speaker) ? input.speaker : 'unknown' });
        s.segments = s.segments.slice(-100); s.revision++;
        if (this.config.spokenRecipient && !s.confirmed && (!s.recipient || s.recipientOrigin === 'speech')) {
          const result = captureRecipient(s.recipientCapture, input.text, s.epoch, this.now());
          s.recipientCapture = result.capture;
          if (result.candidate) { s.recipient = email(result.candidate); s.recipientOrigin = 'speech'; s.outcome = 'Spoken address assembled. Verify every character on the glasses before confirming.'; }
          else if (result.completed || result.capture?.started) {
            s.recipient = '';
            if (result.completed) s.outcome = 'Address could not be assembled. Spell it again with a full domain, or type the literal address on the phone.';
          }
        }
        s.draft = groundedDraft(s.segments, s.revision);
      }
      this.store.put(s);
    });
    if (pending) await this.dispatch(id, owner, pending);
    return this.read(id, owner);
  }
  followup(id: string, owner: string, legacyReviewFlow = false): Session {
    let snapshot: Session | undefined;
    const state = this.store.transaction(() => {
      const s = this.read(id, owner);
      // A repeated button request observes the same job/outbox; never starts another.
      if (s.phase === 'GENERATING' || s.outboxId) return s;
      if (!this.config.oneTap) throw new Fault('Enable one-tap Follow-up on the backend first.');
      if (!this.drafter) throw new Fault('Configure the server OpenAI API key before generating an email. No email sent.');
      if (s.phase !== 'DRAFTING' || !s.confirmed || !s.recipient || !s.segments.some(x => x.final && x.text.trim())) {
        throw new Fault('Start a conversation, confirm the literal recipient, and capture finalized notes before Follow-up.');
      }
      if (this.config.live && !this.liveFollowupAllowed(s)) {
        throw new Fault('Live Follow-up needs verified physical capture/display and an allowlisted test recipient.');
      }
      s.phase = 'GENERATING'; s.arm = null; s.epoch = randomUUID(); s.legacyReviewFlow = legacyReviewFlow;
      s.outcome = 'Writing the email from finalized conversation notes…';
      this.store.put(s); snapshot = structuredClone(s); return s;
    });
    if (snapshot) {
      const input = snapshot;
      let job: Promise<Session>;
      job = Promise.resolve().then(() => this.generateFollowup(input)).finally(() => {
        if (this.followupJobs.get(id) === job) this.followupJobs.delete(id);
      });
      this.followupJobs.set(id, job);
      // generateFollowup handles expected failures; this protects shutdown/storage failures.
      void job.catch(() => { console.error('Follow-up job unavailable; preserve its session and inspect status privately.'); });
    }
    return state;
  }
  async waitForFollowup(id: string): Promise<void> { await this.followupJobs.get(id); }
  private liveFollowupAllowed(s: Session): boolean {
    if (s.source === 'simulation' || !this.config.allowlist.includes(s.recipient)) return false;
    return this.config.hardwareVerified || (!!this.config.selfTestRecipient && s.recipient === this.config.selfTestRecipient);
  }
  private async generateFollowup(snapshot: Session): Promise<Session> {
    const { id, owner, epoch } = snapshot;
    let draft: Draft;
    try {
      draft = await this.drafter!.draft(snapshot.segments, snapshot.revision + 1);
      if (!draft.subject.trim() || draft.subject.length > 180 || /[\r\n]/.test(draft.subject) || !draft.body.trim() || draft.body.length > 6000
        || draft.calendly !== CALENDLY || !draft.body.includes(CALENDLY)
        || !draft.evidenceIds.length || draft.evidenceIds.some(x => !snapshot.segments.some(s => s.id === x && s.final))) {
        throw new Error('Invalid generated message');
      }
    } catch {
      const s = this.read(id, owner);
      if (s.phase === 'GENERATING' && s.epoch === epoch) {
        s.phase = snapshot.legacyReviewFlow ? 'FAILED' : 'DRAFTING';
        s.outcome = snapshot.legacyReviewFlow
          ? 'AI drafting failed. No email sent. End / clear, check the backend configuration, and start a new conversation.'
          : 'AI drafting failed. No email sent; inspect AI configuration or try Follow-up again deliberately.';
        this.store.put(s);
      }
      return s;
    }
    let pending: { identity: string; recipient: string; subject: string; body: string } | undefined;
    this.store.transaction(() => {
      const s = this.read(id, owner);
      // Cancel, correction, expiry, or a new conversation invalidates this result.
      if (s.phase !== 'GENERATING' || s.epoch !== epoch || !s.confirmed || s.recipient !== snapshot.recipient) return;
      if (this.config.live && !this.liveFollowupAllowed(s)) {
        s.phase = s.legacyReviewFlow ? 'FAILED' : 'DRAFTING'; s.outcome = 'Live sending configuration changed. No email sent.'; this.store.put(s); return;
      }
      s.draft = { ...draft, version: snapshot.revision + 1 };
      const message = { ...s.draft, recipient: s.recipient };
      // Historical API field name; here content is frozen by the explicit send gesture,
      // not by message review. Recipient/Calendly/dispatch remain controlled by code.
      s.approved = { ...message, digest: hash(JSON.stringify(message)) };
      const identity = `${s.id}:${s.approved.digest}`;
      s.selfTestOnly = this.config.live && !this.config.hardwareVerified && s.recipient === this.config.selfTestRecipient;
      s.outboxId = identity; s.phase = this.config.live ? 'SENDING' : 'DRY_RUN';
      s.outcome = this.config.live ? 'Sending the generated email through Gmail…' : 'AI email generated in dry-run mode. No email sent.';
      if (s.legacyReviewFlow) s.outcome += `\nTo: ${s.recipient}\nSubject: ${s.draft.subject}`;
      this.store.db.prepare('INSERT INTO outbox(id,session_id,digest,status,created) VALUES (?,?,?,?,?)')
        .run(identity, s.id, s.approved.digest, s.phase, this.now());
      this.store.put(s);
      if (this.config.live) pending = { identity, recipient: s.recipient, subject: s.approved.subject, body: s.approved.body };
    });
    if (pending) await this.dispatch(id, owner, pending);
    return this.read(id, owner);
  }
  private async dispatch(id: string, owner: string, pending: { identity: string; recipient: string; subject: string; body: string }) {
      // Committed SENDING before I/O. No retry on transport/provider ambiguity.
      let result: ProviderOutcome;
      try { result = await this.sender.send(pending); }
      catch { result = { status: 'UNKNOWN', detail: 'Provider outcome unknown; inspect Gmail Sent. Do not resend.' }; }
      // Provider status only: never log transcripts, email content or credentials.
      console.info(`Follow-up Gmail outcome: ${result.status}`);
      this.store.transaction(() => {
        const s = this.store.get(id, owner);
        if (!s.outboxId) throw new Fault('Send identity missing');
        this.store.db.prepare('UPDATE outbox SET status=?,provider_id=? WHERE id=?').run(result.status, result.providerId ?? null, s.outboxId);
        s.phase = result.status; s.outcome = result.detail;
        if (s.selfTestOnly) s.outcome += '\nSelf-test to your Gmail account only. Hardware verification is pending.';
        s.arm = null; this.store.put(s);
      });
  }
  end(id: string, owner: string): Session {
    const s = this.store.get(id, owner);
    s.phase = s.outboxId ? s.phase : 'ENDED'; s.arm = null; s.segments = []; s.draft = null; s.approved = null; s.recipient = ''; s.confirmed = false; s.recipientCapture = undefined; s.recipientOrigin = undefined;
    this.store.put(s); return s;
  }
  purge() {
    for (const row of this.store.db.prepare('SELECT id,owner FROM sessions').all()) {
      const s = this.store.get(String(row.id), String(row.owner));
      if (this.now() >= s.expires) this.end(s.id, s.owner);
      if (this.now() > s.created + 7 * 86400_000) {
        this.store.db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
        this.store.db.prepare('DELETE FROM outbox WHERE session_id=?').run(s.id);
        this.store.db.prepare('DELETE FROM leases WHERE session_id=?').run(s.id);
      }
    }
  }
}
