import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Controller, Store, CALENDLY, pages } from '../src/core.ts';
import type { Draft, Segment, Source, ProviderOutcome } from '../src/core.ts';
import { OpenAIDrafter } from '../src/drafting.ts';
import { makeServer } from '../src/server.ts';

const message = (segments: Segment[], version: number): Draft => ({ version, subject: 'Continuing our conversation',
  body: `Hi,\n\nWe discussed missed follow-ups and a possible next conversation.\n${CALENDLY}\n\nBest,\nArnav`,
  calendly: CALENDLY, evidenceIds: [segments[0]!.id] });
function deferred<T>() { let complete!: (value: T) => void; const promise = new Promise<T>(resolve => complete = resolve); return { promise, complete }; }
function fixture(options: { live?: boolean; verified?: boolean; oneTap?: boolean; draft?: (s: Segment[], v: number) => Promise<Draft>;
  sender?: () => Promise<ProviderOutcome>; noAI?: boolean; selfTest?: string } = {}) {
  const prefix = join(tmpdir(), 'followup-button-'); const dir = mkdtempSync(prefix);
  const path = join(dir, 'test.sqlite'), key = randomBytes(32); const store = new Store(path, key);
  let drafts = 0, sends = 0;
  const controller = new Controller(store, { cue: 'configured cue', live: options.live ?? false,
    hardwareVerified: options.verified ?? false, oneTap: options.oneTap ?? true, allowlist: ['tester@example.com'], selfTestRecipient: options.selfTest },
    { send: async () => { sends++; return options.sender ? options.sender() : { status: 'SENT', detail: 'Fake Gmail accepted', providerId: 'fake' }; } },
    () => 10000, options.noAI ? undefined : { draft: async (s, v) => { drafts++; return options.draft ? options.draft(s, v) : message(s, v); } });
  const prepare = async (source: Source = 'meta-speech') => {
    let s = controller.create('owner', true, source);
    s = await controller.segment(s.id, 'owner', { id: 'note', sequence: 1, epoch: s.epoch, source,
      capturedMs: 0, text: 'We discussed missed follow-ups, not an agreed purchase.', final: true, speaker: 'unknown' });
    s = controller.update(s.id, 'owner', 'recipient', { recipient: 'tester@example.com' });
    return controller.update(s.id, 'owner', 'confirm', { recipient: 'tester@example.com' });
  };
  return { controller, store, path, key, prepare, drafts: () => drafts, sends: () => sends,
    cleanup: () => { store.close(); assert.ok(resolve(dir).startsWith(resolve(prefix))); rmSync(dir, { recursive: true, force: true }); } };
}

test('Follow-up returns promptly, skips message review, and repeated presses share one AI dry-run job', async () => {
  const gate = deferred<Draft>(); const f = fixture({ draft: () => gate.promise });
  try {
    const s = await f.prepare(); const started = f.controller.followup(s.id, 'owner');
    assert.equal(started.phase, 'GENERATING'); assert.equal(started.reviewPage, -1); assert.equal(started.arm, null);
    assert.equal(f.controller.followup(s.id, 'owner').epoch, started.epoch);
    await Promise.resolve(); assert.equal(f.drafts(), 1);
    gate.complete(message(s.segments, 2)); await f.controller.waitForFollowup(s.id);
    const done = f.controller.read(s.id, 'owner'); assert.equal(done.phase, 'DRY_RUN'); assert.equal(f.sends(), 0);
    assert.equal(done.approved?.recipient, 'tester@example.com'); assert.ok(done.approved?.body.includes(CALENDLY));
    assert.equal(f.controller.followup(s.id, 'owner').outboxId, done.outboxId); assert.equal(f.drafts(), 1);
  } finally { f.cleanup(); }
});
test('physical Meta Speech button sends once without the voice timestamp requirement', async () => {
  const sending = deferred<ProviderOutcome>(); const f = fixture({ live: true, verified: true, sender: () => sending.promise });
  try {
    const s = await f.prepare(); f.controller.followup(s.id, 'owner');
    for (let i = 0; i < 10 && f.sends() === 0; i++) await Promise.resolve();
    assert.equal(f.controller.read(s.id, 'owner').phase, 'SENDING'); assert.equal(f.sends(), 1);
    f.controller.followup(s.id, 'owner');
    sending.complete({ status: 'SENT', detail: 'Fake acceptance', providerId: '123' }); await f.controller.waitForFollowup(s.id);
    f.controller.followup(s.id, 'owner'); assert.equal(f.sends(), 1);
  } finally { f.cleanup(); }
});
test('Follow-up requires configured AI, confirmed recipient, finalized notes and explicit enablement', async () => {
  for (const options of [{ noAI: true }, { oneTap: false }, {}]) {
    const f = fixture(options); try {
      const s = await f.prepare();
      if (!options.noAI && options.oneTap !== false) f.controller.update(s.id, 'owner', 'recipient', { recipient: 'corrected@example.com' });
      assert.throws(() => f.controller.followup(s.id, 'owner')); assert.equal(f.drafts(), 0); assert.equal(f.sends(), 0);
    } finally { f.cleanup(); }
  }
  const f = fixture(); try {
    let s = f.controller.create('owner', true, 'meta-speech');
    s = f.controller.update(s.id, 'owner', 'recipient', { recipient: 'tester@example.com' });
    f.controller.update(s.id, 'owner', 'confirm', { recipient: s.recipient });
    assert.throws(() => f.controller.followup(s.id, 'owner')); assert.equal(f.drafts(), 0);
  } finally { f.cleanup(); }
});
test('live button gates reject missing hardware evidence, simulated capture and nonallowlisted recipient before AI', async () => {
  for (const scenario of ['hardware','simulation','recipient']) {
    const f = fixture({ live: true, verified: scenario !== 'hardware' }); try {
      let s = await f.prepare(scenario === 'simulation' ? 'simulation' : 'meta-speech');
      if (scenario === 'recipient') {
        s = f.controller.update(s.id, 'owner', 'recipient', { recipient: 'other@example.com' });
        s = f.controller.update(s.id, 'owner', 'confirm', { recipient: s.recipient });
      }
      assert.throws(() => f.controller.followup(s.id, 'owner')); assert.equal(f.drafts(), 0); assert.equal(f.sends(), 0);
    } finally { f.cleanup(); }
  }
});
test('explicit self-test permits one physical-source button send to the sender without claiming hardware verification', async () => {
  const f = fixture({ live: true, selfTest: 'tester@example.com' });
  try {
    const s = await f.prepare(); f.controller.followup(s.id, 'owner', true); await f.controller.waitForFollowup(s.id);
    const done = f.controller.read(s.id, 'owner'); assert.equal(done.phase, 'SENT'); assert.equal(done.selfTestOnly, true);
    assert.equal(f.controller.config.hardwareVerified, false); assert.ok(done.outcome.includes('Hardware verification is pending'));
    assert.equal(f.sends(), 1); f.controller.followup(s.id, 'owner', true); assert.equal(f.sends(), 1);
  } finally { f.cleanup(); }
});

test('self-test exception rejects other allowlisted recipients and simulation before calling AI or Gmail', async () => {
  for (const scenario of ['recipient', 'simulation']) {
    const f = fixture({ live: true, selfTest: 'tester@example.com' });
    try {
      let s = await f.prepare(scenario === 'simulation' ? 'simulation' : 'meta-speech');
      if (scenario === 'recipient') {
        f.controller.config.allowlist.push('other@example.com');
        s = f.controller.update(s.id, 'owner', 'recipient', { recipient: 'other@example.com' });
        s = f.controller.update(s.id, 'owner', 'confirm', { recipient: s.recipient });
      }
      assert.throws(() => f.controller.followup(s.id, 'owner')); assert.equal(f.drafts(), 0); assert.equal(f.sends(), 0);
    } finally { f.cleanup(); }
  }
});

test('self-test permission and allowlist are rechecked after asynchronous generation before dispatch', async () => {
  for (const scenario of ['permission', 'allowlist']) {
    const gate = deferred<Draft>(); const f = fixture({ live: true, selfTest: 'tester@example.com', draft: () => gate.promise });
    try {
      const s = await f.prepare(); f.controller.followup(s.id, 'owner', true);
      if (scenario === 'permission') f.controller.config.selfTestRecipient = undefined;
      else f.controller.config.allowlist = [];
      gate.complete(message(s.segments, 2)); await f.controller.waitForFollowup(s.id);
      const done = f.controller.read(s.id, 'owner'); assert.equal(done.phase, 'FAILED'); assert.equal(done.outboxId, null); assert.equal(f.sends(), 0);
    } finally { f.cleanup(); }
  }
});

test('self-test permission does not enable unverified voice arming', async () => {
  const f = fixture({ live: true, selfTest: 'tester@example.com' });
  try {
    let s = await f.prepare('hfp'); s = f.controller.update(s.id, 'owner', 'review', {});
    for (let i = 0; i < pages(s).length; i++) s = f.controller.update(s.id, 'owner', 'page', { page: i });
    assert.throws(() => f.controller.update(s.id, 'owner', 'arm', { captureMs: 1000 }), /verified HFP/);
    assert.equal(f.sends(), 0);
  } finally { f.cleanup(); }
});

test('pause, recipient correction, deletion and new conversation cancel a pending AI result before dispatch', async () => {
  for (const action of ['pause','recipient','end','new']) {
    const gate = deferred<Draft>(); const f = fixture({ live: true, verified: true, draft: () => gate.promise });
    try {
      const s = await f.prepare(); f.controller.followup(s.id, 'owner');
      if (action === 'end') f.controller.end(s.id, 'owner');
      else if (action === 'new') f.controller.create('owner', true, 'meta-speech');
      else f.controller.update(s.id, 'owner', action, action === 'recipient' ? { recipient: 'corrected@example.com' } : {});
      gate.complete(message(s.segments, 2)); await f.controller.waitForFollowup(s.id);
      assert.equal(f.sends(), 0); assert.equal(f.controller.read(s.id, 'owner').outboxId, null);
    } finally { f.cleanup(); }
  }
});
test('an old cancelled generation cannot erase the tracking of a newer deliberate Follow-up job', async () => {
  const first = deferred<Draft>(), second = deferred<Draft>(); let attempt = 0;
  const f = fixture({ draft: () => (++attempt === 1 ? first.promise : second.promise) });
  try {
    const s = await f.prepare(); f.controller.followup(s.id, 'owner'); await Promise.resolve();
    f.controller.update(s.id, 'owner', 'pause', {}); f.controller.update(s.id, 'owner', 'resume', {});
    f.controller.followup(s.id, 'owner'); await Promise.resolve();
    first.complete(message(s.segments, 2)); await new Promise(resolve => setImmediate(resolve));
    let settled = false; const waiting = f.controller.waitForFollowup(s.id).then(() => settled = true);
    await Promise.resolve(); assert.equal(settled, false);
    second.complete(message(s.segments, 2)); await waiting; assert.equal(f.controller.read(s.id, 'owner').phase, 'DRY_RUN');
  } finally { f.cleanup(); }
});
test('AI failures and invalid generated content never create an outbox or send', async () => {
  for (const draft of [async () => { throw new Error('Fake AI unavailable'); },
    async (s: Segment[], v: number) => ({ ...message(s, v), calendly: 'https://evil.example' })]) {
    const f = fixture({ draft, live: true, verified: true }); try {
      const s = await f.prepare(); f.controller.followup(s.id, 'owner'); await f.controller.waitForFollowup(s.id);
      const state = f.controller.read(s.id, 'owner'); assert.equal(state.phase, 'DRAFTING');
      assert.ok(state.outcome.includes('No email sent')); assert.equal(state.outboxId, null); assert.equal(f.sends(), 0);
    } finally { f.cleanup(); }
  }
});
test('restarting during generation pauses the job and prevents automatic dispatch', async () => {
  const gate = deferred<Draft>(); const f = fixture({ live: true, verified: true, draft: () => gate.promise });
  try {
    const s = await f.prepare(); f.controller.followup(s.id, 'owner');
    const restarted = new Store(f.path, f.key);
    try {
      assert.equal(restarted.get(s.id, 'owner').phase, 'PAUSED');
      gate.complete(message(s.segments, 2)); await f.controller.waitForFollowup(s.id); assert.equal(f.sends(), 0);
    } finally { restarted.close(); }
  } finally { f.cleanup(); }
});
test('UNKNOWN Gmail button outcome remains durable and another button press never retries', async () => {
  const f = fixture({ live: true, verified: true, sender: async () => ({ status: 'UNKNOWN', detail: 'Fake timeout' }) });
  try {
    const s = await f.prepare(); f.controller.followup(s.id, 'owner'); await f.controller.waitForFollowup(s.id);
    assert.equal(f.controller.followup(s.id, 'owner').phase, 'UNKNOWN'); assert.equal(f.sends(), 1);
    const restarted = new Store(f.path, f.key); try { assert.equal(restarted.get(s.id, 'owner').phase, 'UNKNOWN'); } finally { restarted.close(); }
  } finally { f.cleanup(); }
});
test('HTTP Follow-up route authenticates, accepts quickly, exposes progress and completes without Gmail in dry-run', async () => {
  const gate = deferred<Draft>(); const f = fixture({ draft: () => gate.promise }); const token = randomBytes(32).toString('hex');
  const server = makeServer(f.controller, token); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const url = `http://127.0.0.1:${address.port}`;
  const post = async (path: string, body: unknown = {}) => fetch(url + path, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const health = await (await fetch(url + '/health')).json() as { oneTapEnabled: boolean; aiConfigured: boolean; liveSending: boolean };
    assert.equal(health.oneTapEnabled, true); assert.equal(health.aiConfigured, true); assert.equal(health.liveSending, false);
    let e = await (await post('/sessions', { consent: true, source: 'meta-speech' })).json() as { session: { id: string; epoch: string } };
    const path = `/sessions/${e.session.id}`;
    await post(path + '/segment', { id: 'note', sequence: 1, epoch: e.session.epoch, source: 'meta-speech', capturedMs: 0,
      text: 'We discussed missed follow-ups.', final: true, speaker: 'unknown' });
    await post(path + '/recipient', { recipient: 'tester@example.com' }); await post(path + '/confirm', { recipient: 'tester@example.com' });
    assert.equal((await fetch(url + path + '/followup', { method: 'POST' })).status, 401);
    const accepted = await post(path + '/followup'); assert.equal(accepted.status, 202);
    assert.equal(((await accepted.json()) as {session:{phase:string}}).session.phase, 'GENERATING');
    assert.equal((await post(path + '/followup')).status, 202);
    gate.complete(message([{ id: 'note' } as Segment], 2)); await f.controller.waitForFollowup(e.session.id);
    const result = await (await fetch(url + path, { headers: { Authorization: `Bearer ${token}` } })).json() as { session: {phase:string; approved:Draft} };
    assert.equal(result.session.phase, 'DRY_RUN'); assert.ok(result.session.approved.body.includes(CALENDLY)); assert.equal(f.sends(), 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.cleanup(); }
});

function aiResponse(value: unknown, status = 'completed') {
  return new Response(JSON.stringify({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }));
}
const notes: Segment[] = [{ id: 'note', text: 'We discussed missed follow-ups, not an agreed purchase.', final: true,
  epoch: 'epoch', sequence: 1, capturedMs: 0, source: 'meta-speech', speaker: 'unknown' }];
const output = { subject: 'Following up', paragraphs: ['We discussed improving how you handle follow-ups.'],
  evidence: [{ id: 'note', quote: 'missed follow-ups' }] };
test('OpenAI agent uses structured output, validates source quotes and adds the fixed booking link in code', async () => {
  const agent = new OpenAIDrafter('fake-key', 'test-model', (async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(String(options?.body)); assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true); assert.equal(request.model, 'test-model');
    assert.ok(request.instructions.includes('untrusted transcript')); assert.ok(!String(options?.body).includes('tester@example.com'));
    return aiResponse(output);
  }) as typeof fetch);
  const draft = await agent.draft(notes, 3); assert.equal(draft.version, 3); assert.deepEqual(draft.evidenceIds, ['note']);
  assert.equal(draft.calendly, CALENDLY); assert.ok(draft.body.includes(CALENDLY));
});
test('AI refusal, truncation, forged evidence and generated addresses/URLs fail closed before Gmail', async () => {
  for (const value of [{ ...output, evidence: [{ id: 'other', quote: 'missed follow-ups' }] },
    { ...output, evidence: [{ id: 'note', quote: 'an agreed purchase today' }] },
    { ...output, paragraphs: ['Book https://evil.example instead.'] }, { ...output, paragraphs: ['Send to someone@example.com.'] }]) {
    const agent = new OpenAIDrafter('fake', 'model', (async () => aiResponse(value)) as typeof fetch);
    await assert.rejects(agent.draft(notes, 1));
  }
  for (const status of ['incomplete','failed']) {
    const agent = new OpenAIDrafter('fake', 'model', (async () => aiResponse(output, status)) as typeof fetch);
    await assert.rejects(agent.draft(notes, 1));
  }
  const refusal = new OpenAIDrafter('fake', 'model', (async () => new Response(JSON.stringify({ status: 'completed',
    output: [{type:'message', content:[{type:'refusal', refusal:'Fake refusal'}]}] }))) as typeof fetch);
  await assert.rejects(refusal.draft(notes, 1));
});
