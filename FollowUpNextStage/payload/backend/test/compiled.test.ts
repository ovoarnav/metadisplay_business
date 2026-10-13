import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('compiled JavaScript server starts, responds to health and authenticates session creation', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'followup-built-'));
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, ['dist/server.js'], { cwd: root, env: { ...process.env,
    PORT: '0', APP_AUTH_TOKEN: token, DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    DATABASE_PATH: join(dir, 'test.sqlite'), ALLOW_LIVE_EMAIL: 'false', HARDWARE_CAPTURE_VERIFIED: 'false' }, stdio: ['ignore','pipe','pipe'] });
  // Startup exports port through stdout only; no credential output.
  let output = '';
  child.stdout.on('data', chunk => output += chunk.toString());
  child.stderr.on('data', chunk => output += chunk.toString());
  try {
    for (let i = 0; i < 100 && !output.includes('port='); i++) {
      if (child.exitCode !== null) throw new Error('Compiled server exited: ' + output);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const port = /port=(\d+)/.exec(output)?.[1]; assert.ok(port, output);
    const url = `http://127.0.0.1:${port}`;
    const health = await fetch(url + '/health'); assert.equal(health.status, 200);
    assert.equal(((await health.json()) as {liveSending:boolean}).liveSending, false);
    const created = await fetch(url + '/sessions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true, source: 'simulation' }) });
    assert.equal(created.status, 201);
    assert.ok(!output.includes(token));
  } finally {
    if (child.exitCode === null) {
      const stopped = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill(); await stopped;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
