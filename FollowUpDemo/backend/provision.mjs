import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function provisionBackend(directory) {
  const root = path.resolve(directory);
  const template = readFileSync(path.join(root, '.env.example'), 'utf8');
  const env = template.replace(/^APP_AUTH_TOKEN=\r?$/m, `APP_AUTH_TOKEN=${randomBytes(32).toString('hex')}`)
    .replace(/^DATA_ENCRYPTION_KEY=\r?$/m, `DATA_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
  if (!/^APP_AUTH_TOKEN=[a-f0-9]{64}$/m.test(env) || !/^DATA_ENCRYPTION_KEY=[a-f0-9]{64}$/m.test(env)) {
    throw new Error('Secret template is incomplete; no configuration file written.');
  }
  mkdirSync(path.join(root, '.data'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(root, '.env'), env, { flag: 'wx', mode: 0o600 });
  console.log('Private backend .env created. Configure provider keys in a private editor. Live sending remains disabled.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) provisionBackend(process.cwd());
