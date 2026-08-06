// Production server launcher for the standalone build.
//
// `next start` does not work with `output: standalone` (Next warns about it
// and the compat server misbehaves: no .env loading, inconsistent auth), so
// this script does what the Dockerfile does:
//   1. assemble .next/standalone/ (server.js + traced deps)
//   2. copy .next/static and public/ into it (not traced by standalone)
//   3. run `node --env-file=.env server.js` — Node parses .env natively, so
//      values with $, #, @ etc. are never touched by the shell
//
// Usage: npm run build && npm run start   (PORT/HOSTNAME env override, defaults 3210/127.0.0.1)
import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const standalone = join(root, '.next', 'standalone');

if (!existsSync(join(standalone, 'server.js'))) {
  console.error('No standalone build found. Run `npm run build` first.');
  process.exit(1);
}

cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), {
  recursive: true,
  force: true,
});
if (existsSync(join(root, 'public'))) {
  cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true, force: true });
}

const port = process.env.PORT ?? '3210';
const hostname = process.env.HOSTNAME ?? '127.0.0.1';
console.log(`[serve] starting standalone server on http://${hostname}:${port}`);

const child = spawn(process.execPath, ['--env-file', join(root, '.env'), 'server.js'], {
  cwd: standalone,
  stdio: 'inherit',
  env: { ...process.env, PORT: port, HOSTNAME: hostname },
});
child.on('exit', (code) => process.exit(code ?? 0));
