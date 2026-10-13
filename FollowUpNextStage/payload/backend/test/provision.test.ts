import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('private provisioning supports LF/CRLF, prints no secrets, and preserves an existing encryption key', () => {
  const script = fileURLToPath(new URL('../provision.mjs', import.meta.url));
  for (const newline of ['\n','\r\n']) {
    const prefix = join(tmpdir(), 'followup-provision-'); const dir = mkdtempSync(prefix);
    try {
      writeFileSync(join(dir, '.env.example'), ['APP_AUTH_TOKEN=','DATA_ENCRYPTION_KEY=','ALLOW_LIVE_EMAIL=false',''].join(newline));
      const first = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' }); assert.equal(first.status, 0);
      const data = readFileSync(join(dir, '.env'), 'utf8');
      const token = /^APP_AUTH_TOKEN=([a-f0-9]{64})$/m.exec(data)?.[1];
      const key = /^DATA_ENCRYPTION_KEY=([a-f0-9]{64})$/m.exec(data)?.[1];
      assert.ok(token && key); assert.ok(!first.stdout.includes(token)); assert.ok(!first.stdout.includes(key));
      const second = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' }); assert.notEqual(second.status, 0);
      assert.equal(readFileSync(join(dir, '.env'), 'utf8'), data);
    } finally { assert.ok(resolve(dir).startsWith(resolve(prefix))); rmSync(dir, { recursive: true, force: true }); }
  }
});
