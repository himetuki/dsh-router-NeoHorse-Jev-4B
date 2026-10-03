// The plugin page's tier editor, offline: the tier merge/validation the page and the router share,
// and the same-origin routes that back the form (GET config, GET catalog, POST config).
//
//     node config.test.mjs
import { effectiveTiers, installConfigRoute, normalizeTiersInput, TIER_TABLE } from './index.js';

let pass = 0;
const fail = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── effectiveTiers: only a tier naming BOTH provider and model replaces the default ─────────────
check('no overrides -> built-in table', effectiveTiers({}), TIER_TABLE);
check('empty tiers object -> built-in table', effectiveTiers({ tiers: {} }), TIER_TABLE);
check('schema-materialised empty tiers -> built-in table',
  effectiveTiers({ tiers: { low: {}, high: {}, max: {}, fallback: {} } }), TIER_TABLE);
check('partial tier (provider only) keeps the default',
  effectiveTiers({ tiers: { low: { provider: 'xiaomi' } } }).low, TIER_TABLE.low);
check('complete tier replaces without effort',
  effectiveTiers({ tiers: { low: { provider: 'xiaomi', model: 'mimo-v2.6-flash' } } }).low,
  { provider: 'xiaomi', model: 'mimo-v2.6-flash' });
check('blank effort means no effort field',
  effectiveTiers({ tiers: { high: { provider: 'xiaomi', model: 'mimo', effort: '' } } }).high,
  { provider: 'xiaomi', model: 'mimo' });
check('named effort is kept',
  effectiveTiers({ tiers: { max: { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'max' } } }).max,
  { provider: 'deepseek-official', model: 'deepseek-flash', effort: 'max' });
check('untouched tiers keep defaults',
  (() => { const t = effectiveTiers({ tiers: { low: { provider: 'a', model: 'b' } } }); return [t.high, t.max, t.fallback]; })(),
  [TIER_TABLE.high, TIER_TABLE.max, TIER_TABLE.fallback]);

// ── normalizeTiersInput: the write path rejects an incomplete row instead of keeping a default ──
check('valid table', normalizeTiersInput({ low: { provider: 'xiaomi', model: 'mimo', effort: 'low' } }),
  { tiers: { low: { provider: 'xiaomi', model: 'mimo', effort: 'low' } } });
check('blank effort is preserved as empty', normalizeTiersInput({ max: { provider: 'a', model: 'b', effort: '' } }),
  { tiers: { max: { provider: 'a', model: 'b', effort: '' } } });
check('missing provider -> error', normalizeTiersInput({ low: { model: 'b' } }).error !== undefined, true);
check('missing model -> error', normalizeTiersInput({ low: { provider: 'a' } }).error !== undefined, true);
check('unknown tier -> error', normalizeTiersInput({ medium: { provider: 'a', model: 'b' } }).error !== undefined, true);
check('non-object -> error', normalizeTiersInput('nope').error !== undefined, true);
check('partial table is allowed (other tiers keep defaults)',
  normalizeTiersInput({ fallback: { provider: 'a', model: 'b' } }),
  { tiers: { fallback: { provider: 'a', model: 'b', effort: '' } } });

// ── routes: config (GET/POST) and catalog, driven through a stub webServer ──────────────────────
const handlers = [];
function fakeResponse() {
  const capture = { statusCode: 0, headers: {}, body: '' };
  capture.setHeader = (key, value) => { capture.headers[key] = value; };
  capture.end = (text) => { capture.body = text === undefined ? '' : String(text); };
  capture.json = () => JSON.parse(capture.body);
  return capture;
}
function fakeRequest(method, url, body) {
  const listeners = {};
  const req = {
    method,
    url,
    on(event, callback) { (listeners[event] = listeners[event] || []).push(callback); return req },
    destroy() {},
    respond(withBody) {
      if (withBody !== undefined) for (const callback of listeners.data || []) callback(withBody);
      for (const callback of listeners.end || []) callback();
    },
  };
  return req;
}

const edits = [];
const fakeLlm = {
  listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek API' }],
  listConfigurableProviders: () => [
    { provider: 'xiaomi', displayName: 'xiaomi' },
    { provider: 'deepseek-official', displayName: 'duplicate entry' },
    { provider: 'step-plan', displayName: '阶跃' },
  ],
  listModels: async (provider) => (provider === 'xiaomi' ? [{ id: 'mimo-v2.6-flash', name: 'Mimo Flash' }] : []),
  resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } }),
};
const fakeEditor = {
  entries: () => [{ options: { id: 'router-neohorse', name: 'dsh-router-neohorse' } }],
  edit: async (_entry, change) => { const next = change({ mode: 'auto' }, {}); edits.push(next); return next; },
};
const fakeCtx = {
  get: (key) => (key === 'llm' ? fakeLlm : key === 'configEditor' ? fakeEditor : undefined),
  inject: (_services, callback) => callback({
    get: (key) => (key === 'webServer'
      ? { register: (route) => { handlers.push(route); return () => handlers.splice(handlers.indexOf(route), 1); } }
      : fakeCtx.get(key)),
    effect: (fn) => fn(),
  }),
};

installConfigRoute(fakeCtx, { tiers: { low: { provider: 'xiaomi', model: 'mimo-v2.6-flash' } } });
const configRoute = handlers.find((route) => route.path === '/router-neohorse/config');
const catalogRoute = handlers.find((route) => route.path === '/router-neohorse/catalog');
check('both routes registered', [configRoute !== undefined, catalogRoute !== undefined], [true, true]);

const getRes = fakeResponse();
configRoute.handler(fakeRequest('GET', '/router-neohorse/config'), getRes);
await new Promise((resolve) => setTimeout(resolve, 0));
const got = getRes.json();
check('GET config status', getRes.statusCode, 200);
check('GET config tiers', got.tiers.low, { provider: 'xiaomi', model: 'mimo-v2.6-flash' });
check('GET config providers deduped + sorted', got.providers.map((p) => p.id), ['deepseek-official', 'step-plan', 'xiaomi']);
check('GET config writable', got.writable, true);

const postReq = fakeRequest('POST', '/router-neohorse/config');
const postRes = fakeResponse();
configRoute.handler(postReq, postRes);
postReq.respond(JSON.stringify({ tiers: { max: { provider: 'sensenova', model: 'kimi-k3', effort: '' } } }));
await new Promise((resolve) => setTimeout(resolve, 0));
check('POST config status', postRes.statusCode, 200);
check('POST persisted through the config editor', edits.length, 1);
check('POST wrote tiers and kept other config', edits[0],
  { mode: 'auto', tiers: { max: { provider: 'sensenova', model: 'kimi-k3', effort: '' } } });
check('POST echoes effective tiers', postRes.json().tiers.max, { provider: 'sensenova', model: 'kimi-k3' });

const badReq = fakeRequest('POST', '/router-neohorse/config');
const badRes = fakeResponse();
configRoute.handler(badReq, badRes);
badReq.respond(JSON.stringify({ tiers: { low: { provider: 'xiaomi' } } }));
await new Promise((resolve) => setTimeout(resolve, 0));
check('POST incomplete tier -> 400', badRes.statusCode, 400);
check('POST incomplete tier keeps the editor untouched', edits.length, 1);

const catRes = fakeResponse();
catalogRoute.handler(fakeRequest('GET', '/router-neohorse/catalog?provider=xiaomi&model=mimo-v2.6-flash'), catRes);
await new Promise((resolve) => setTimeout(resolve, 0));
check('catalog status', catRes.statusCode, 200);
check('catalog models', catRes.json().models, [{ id: 'mimo-v2.6-flash', name: 'Mimo Flash' }]);
check('catalog efforts', catRes.json().efforts, [{ id: 'low', name: 'Low' }]);
check('catalog default effort', catRes.json().defaultEffort, 'low');

console.log('='.repeat(70));
console.log(`  tier editor (config page): ${pass} passed, ${fail.length} failed`);
console.log('='.repeat(70));
for (const line of fail) console.log('  FAIL ' + line);
process.exit(fail.length ? 1 : 0);
