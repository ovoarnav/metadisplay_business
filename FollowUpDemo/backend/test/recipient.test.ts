import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Controller, Store, CALENDLY } from '../src/core.ts';
import { recipientCandidate, captureRecipient } from '../src/recipient.ts';
import type { RecipientCapture } from '../src/recipient.ts';

test('recipient formatting joins explicit spaces, at/dot/digits without guessing missing characters or domain', () => {
  assert.equal(recipientCandidate('arnav nambiar nine eight one at gmail dot com'), 'arnavnambiar981@gmail.com');
  assert.equal(recipientCandidate(' a.name+tag@example.com '), 'a.name+tag@example.com');
  assert.equal(recipientCandidate('a underscore b dash seven at example dot org'), 'a_b-7@example.org');
  assert.equal(recipientCandidate('a b at gmail'), null);
  assert.equal(recipientCandidate('a@example.com\r\nBcc: other@example.com'), null);
  assert.equal(recipientCandidate('a@example.com or b@example.com'), null);
  assert.equal(recipientCandidate('v at example dot com'), 'v@example.com'); // Never silently turn v into b.
});

test('spoken recipient assembles across final chunks and needs the explicit completion cue', () => {
  let capture: RecipientCapture | undefined;
  for (const text of ['My email', 'address is arnav', 'nambiar nine eight one at', 'gmail dot com']) {
    const result = captureRecipient(capture, text, 'epoch', 1000); capture = result.capture;
    assert.equal(result.candidate, undefined);
  }
  const done = captureRecipient(capture, 'Email complete.', 'epoch', 1001);
  assert.equal(done.candidate, 'arnavnambiar981@gmail.com'); assert.equal(done.capture, undefined);
});

test('ordinary conversation, stale epochs, expired collection and incomplete domains cannot choose an address', () => {
  assert.equal(captureRecipient(undefined, 'Talk to our team at example dot com. Email complete.', 'epoch', 0).candidate, undefined);
  const begun = captureRecipient(undefined, 'My email is a at', 'epoch', 0).capture;
  assert.equal(captureRecipient(begun, 'example dot com. Email complete.', 'other', 1).candidate, undefined);
  assert.equal(captureRecipient(begun, 'example dot com. Email complete.', 'epoch', 90001).candidate, undefined);
  assert.equal(captureRecipient(undefined, 'My email is a at gmail. Email complete.', 'epoch', 0).candidate, undefined);
});

test('sentence punctuation on separate recognition callbacks does not become invented address punctuation', () => {
  let capture: RecipientCapture | undefined;
  for (const text of ['My email.', 'is Arnav.', 'Nambiar.', 'Nine eight one at.', 'Gmail dot com.']) {
    capture = captureRecipient(capture, text, 'epoch', 1000).capture;
  }
  assert.equal(captureRecipient(capture, 'Email complete.', 'epoch', 1001).candidate, 'arnavnambiar981@gmail.com');
  const explicitDot = captureRecipient(undefined, 'My email is a dot b at example dot com. Email complete.', 'epoch', 1000);
  assert.equal(explicitDot.candidate, 'a.b@example.com');
});

function fixture(spokenRecipient = true) {
  const store = new Store(':memory:', randomBytes(32));
  const ctl = new Controller(store, { cue: 'cue', live: false, hardwareVerified: false, allowlist: [], oneTap: true, spokenRecipient },
    { send: async () => { throw Error('No Gmail expected'); } }, () => 1000,
    { draft: async (notes, version) => ({ version, subject: 'Test', body: `Notes\n${CALENDLY}`, calendly: CALENDLY, evidenceIds: [notes[0]!.id] }) });
  let s = ctl.create('owner', true, 'meta-speech'); let sequence = 0;
  const add = async (text: string, final = true) => { s = await ctl.segment(s.id, 'owner', { id: `note-${++sequence}`, sequence,
    epoch: s.epoch, source: s.source, capturedMs: 0, text, final, speaker: 'unknown' }); return s; };
  return { store, ctl, add, state: () => s, refresh: () => s = ctl.read(s.id, 'owner') };
}

test('installed-client flow captures an initially empty address, returns it for literal confirmation, and cannot send before confirmation', async () => {
  const f = fixture(); try {
    await f.add('My email is arnav nambiar'); await f.add('nine eight one at gmail dot com.');
    assert.equal(f.state().recipient, ''); await f.add('Email complete.');
    const s = f.state(); assert.equal(s.recipient, 'arnavnambiar981@gmail.com'); assert.equal(s.confirmed, false);
    assert.throws(() => f.ctl.followup(s.id, 'owner', true));
    assert.throws(() => f.ctl.update(s.id, 'owner', 'confirm', { recipient: 'wrong@gmail.com' }));
    f.ctl.update(s.id, 'owner', 'confirm', { recipient: s.recipient }); f.refresh();
    await f.add('My email is someone else at example dot com. Email complete.');
    assert.equal(f.state().recipient, 'arnavnambiar981@gmail.com'); assert.equal(f.state().confirmed, true);
  } finally { f.store.close(); }
});

test('spoken intake is opt-in, never uses partials, and does not override a manually chosen recipient', async () => {
  const off = fixture(false); try { await off.add('My email is a at example dot com. Email complete.'); assert.equal(off.state().recipient, ''); } finally { off.store.close(); }
  const f = fixture(); try {
    await f.add('My email is a at example dot com. Email complete.', false); assert.equal(f.state().recipient, '');
    f.ctl.update(f.state().id, 'owner', 'recipient', { recipient: 'tester@example.com' }); f.refresh();
    await f.add('My email is other at example dot com. Email complete.'); assert.equal(f.state().recipient, 'tester@example.com');
  } finally { f.store.close(); }
});

test('repeating a spelled address corrects an unconfirmed spoken candidate and hides the stale candidate while collecting', async () => {
  const f = fixture(); try {
    await f.add('My email is wrong at gmail dot com. Email complete.'); assert.equal(f.state().recipient, 'wrong@gmail.com');
    await f.add('My email is arnav nambiar'); assert.equal(f.state().recipient, '');
    await f.add('nine eight one at gmail dot com. Email complete.'); assert.equal(f.state().recipient, 'arnavnambiar981@gmail.com');
    assert.equal(f.state().confirmed, false); assert.equal(f.state().recipientOrigin, 'speech');
    f.ctl.end(f.state().id, 'owner'); const ended = f.ctl.read(f.state().id, 'owner'); assert.equal(ended.recipientOrigin, undefined);
  } finally { f.store.close(); }
});

test('recipient correction and edit rotate the capture epoch so client sequence restart does not lose later context', async () => {
  const f = fixture(); try {
    await f.add('Earlier discussion.'); const old = f.state();
    const corrected = f.ctl.update(old.id, 'owner', 'recipient', { recipient: 'test at example dot com' });
    assert.notEqual(corrected.epoch, old.epoch); assert.equal(corrected.lastSequence, 0);
    const result = await f.ctl.segment(old.id, 'owner', { id: 'fresh', sequence: 1, epoch: corrected.epoch, source: old.source,
      capturedMs: 0, text: 'More useful context after correction.', final: true, speaker: 'unknown' });
    assert.equal(result.segments.length, 2);
    const edited = f.ctl.update(old.id, 'owner', 'edit', {}); assert.notEqual(edited.epoch, corrected.epoch); assert.equal(edited.lastSequence, 0);
    const ended = f.ctl.end(old.id, 'owner'); assert.equal(ended.recipientCapture, undefined); assert.deepEqual(ended.segments, []);
  } finally { f.store.close(); }
});
