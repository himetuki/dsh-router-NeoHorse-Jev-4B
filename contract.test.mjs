// Offline wire-contract check for the NeoHorse judge: boots a loopback mock System One endpoint
// that answers the choice questions like TokenRhythm, and asserts judgeTier/judgeDifficulty return
// the parsed tier/reason contract, plus the fail-safe paths (missing credentials, 401).
//
//     node contract.test.mjs
import http from 'node:http';
import { judgeDifficulty, judgeTier } from './index.js';

let pass = 0;
const fail = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// Mock TokenRhythm System One: answers tier=high/reason=content and difficulty=hard; 401 on a
// wrong bearer token.
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw);
    if (req.headers.authorization !== 'Bearer test-key') {
      res.statusCode = 401;
      res.end(JSON.stringify({ code: 'AUTH', message: 'invalid key', traceId: 'mock-1' }));
      return;
    }
    const answers = {};
    if (body.questions.tier !== undefined) answers.tier = { choice: 'high' };
    if (body.questions.reason !== undefined) answers.reason = { choice: 'content' };
    if (body.questions.difficulty !== undefined) answers.difficulty = { choice: 'hard' };
    res.statusCode = 200;
    res.end(JSON.stringify({ model: 'NeoHorse-Jev-4B', answers }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1/systemone`;

const credentials = { resolve: async () => ({ value: 'test-key', source: 'file' }) };
const ctx = { get: (name) => (name === 'credentials' ? credentials : undefined) };
const cfg = { baseUrl: base, model: 'NeoHorse-Jev-4B', credentialRef: 'TEST_KEY', timeoutMs: 5000 };

// judgeTier happy path: tier + reason parsed from the two choice answers.
const j = await judgeTier(ctx, cfg, '帮我把 40 个测试文件迁移到 tmp_path', 'low', '帮我优化一下', 's1');
check('judgeTier tier', j, { tier: 'high', triggered_by: 'content', labels: null });

// judgeTier: empty task -> null (never called).
check('judgeTier empty task', await judgeTier(ctx, cfg, '', undefined, undefined, 's2'), null);

// judgeTier: credentials service missing -> null (fail-safe, no throw).
check('judgeTier no credentials -> null', await judgeTier({ get: () => undefined }, cfg, 'hi', undefined, undefined, 's3'), null);

// judgeTier: credential value empty -> null.
check('judgeTier empty key -> null',
  await judgeTier({ get: () => ({ resolve: async () => ({ value: '' }) }) }, cfg, 'hi', undefined, undefined, 's4'), null);

// judgeTier: 401 -> null (fail-safe).
const badCtx = { get: () => ({ resolve: async () => ({ value: 'wrong' }) }) };
check('judgeTier 401 -> null', await judgeTier(badCtx, cfg, 'hi', undefined, undefined, 's5'), null);

// judgeDifficulty happy path.
check('judgeDifficulty hard', await judgeDifficulty(ctx, cfg, '迁移 40 个测试文件', 's6'), 'hard');

// judgeDifficulty fail-safe.
check('judgeDifficulty no credentials -> null', await judgeDifficulty({ get: () => undefined }, cfg, 'hi', 's7'), null);

server.close();
console.log('='.repeat(70));
console.log(`  NeoHorse System One contract: ${pass} passed, ${fail.length} failed`);
console.log('='.repeat(70));
for (const line of fail) console.log('  FAIL ' + line);
process.exit(fail.length ? 1 : 0);
