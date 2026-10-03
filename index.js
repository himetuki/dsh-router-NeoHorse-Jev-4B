/**
 * Router plugin for the routing experiment: the *judge* half.
 *
 * Two layers live here, and they are the two the handoff calls layer 1:
 *
 *   1. `ROUTEEXP_ARM='provider/model:effort'` -- a fixed arm. Unchanged, and still the whole control
 *      surface for the pilot: unset means this plugin does nothing at all, which is why it is safe to
 *      leave installed anywhere.
 *   2. `ROUTEEXP_ARM='judge'` -- ask a cheap model to rate the first task text of a session once
 *      (easy | medium | hard), cache that verdict per session, and map it through `ROUTE_TABLE` to a
 *      route for every request in that session.
 *
 * A comma-separated list still cycles routes per request, which is what the cache question needed.
 * The effort level is whatever the target route accepts -- this file does not own that vocabulary.
 *
 * The judge is a *level*, never a route: it answers one word, so a routing table can be re-tuned
 * without re-prompting it. It is one cheap call per session and `ROUTE_TABLE.fallback` covers every
 * failure path, so a judge that is slow, refused, or nonsensical degrades to the fallback column
 * instead of breaking the session.
 *
 * Deferring to an explicit route (see ROUTEEXP_RESPECT_EXPLICIT below) exists because the `subagent`
 * tool can carry its own provider/model/effort. Without it this plugin would overwrite the very
 * choice layer 2 just made.
 *
 * Logging goes to stderr only: a headless run prints the session's final answer on stdout, and a
 * plugin writing there would corrupt it.
 */

export const name = 'router-neohorse';

// The judge is a remote System One decision call (TokenRhythm NeoHorse-Jev-4B). The API key is
// resolved by reference through DSH's `credentials` service -- the plugin never reads the key itself.
export const inject = ['credentials'];

// Node builtins + schemastery only. The judge is a remote System One call, so there is no local
// service to spawn or health-check. `@deepseek-ai/schemastery` is a peer the profile provides:
// bare it only resolves once the package sits under a `node_modules` that reaches the harness.
import z from '@deepseek-ai/schemastery';

const DEFAULT_PROVIDER = 'deepseek-official';

/** Difficulty levels the judge may answer with, easiest first. */
export const LEVELS = ['easy', 'medium', 'hard'];

/**
 * Judgment -> route. The single place a policy change belongs.
 *
 * Two steps, not three: the pilot found no accuracy difference between *capable* routes on anything
 * it could measure, so a middle tier would be a claim without evidence. `medium` repeats `fallback`
 * deliberately.
 *
 * `hard` is Qwen `qwen3.8-flash` at `xhigh`, not a DeepSeek pro route: the flash-class model under
 * test here already outperforms the pro tier, so escalating up the same vendor buys nothing. Its
 * effort vocabulary is `low|medium|xhigh` -- there is no `max`, which is exactly why the levels are
 * no longer hardcoded in `parseArm`.
 */
export const ROUTE_TABLE = {
  easy: { provider: DEFAULT_PROVIDER, model: 'deepseek-flash', effort: 'low' },
  medium: { provider: DEFAULT_PROVIDER, model: 'deepseek-flash', effort: 'low' },
  hard: { provider: 'qwen-token-plan-cn', model: 'qwen3.8-flash', effort: 'xhigh' },
  fallback: { provider: DEFAULT_PROVIDER, model: 'deepseek-flash', effort: 'low' },
};

/** Judge defaults: the TokenRhythm System One endpoint and its NeoHorse-Jev-4B decision model. */
const DEFAULT_JUDGE_BASE_URL = 'https://tokenrhythm.studio/v1/systemone';
const DEFAULT_JUDGE_MODEL = 'NeoHorse-Jev-4B';
const DEFAULT_CREDENTIAL_REF = 'JEV_API_KEY';
const JUDGE_TIMEOUT_MS = 30000;
/** Task text is truncated before it reaches the judge. */
const JUDGE_MAX_CHARS = 4000;
/** Tier and reason vocabularies the System One judge may answer with. */
const TIER_OPTIONS = ['low', 'high', 'max'];
const REASON_OPTIONS = ['content', 'intent_force', 'intent_inherit', 'intent_exclude', 'escalate_regenerate'];

/**
 * The runtime mode switch (2026-09-25).
 *
 * Until now the mode was a *mount-time constant*: `ROUTEEXP_ARM` (an environment variable, so it only
 * exists when dsh was launched from a shell that exported it) or the row's `cfg.auto`. Measured live:
 * a row driven by the env var silently routed nothing after a GUI restart, because the variable was
 * never in the GUI's environment. There was no way to switch back to manual without editing
 * `cordis.patch.yml` and restarting.
 *
 * So the mode lives in a settings namespace instead, and is read **per request** rather than once at
 * apply(): flipping the switch takes effect on the next model call, with no restart. A composition
 * with no settings plane still works -- the read falls back to the mount-time value (`cfg`, then
 * `ROUTEEXP_ARM`), which is exactly the old behaviour.
 *
 * The two layers answer different questions and must not be confused: the *mode* selects whether auto
 * routing runs at all; the *tier table* selects where a judged tier lands. Only the first is a user
 * preference, so only the first is in settings.
 */
export const MODE_NS = 'router-neohorse';
/** `auto` routes every turn; `manual` leaves every request exactly as its owner configured it. */
export const MODES = ['manual', 'auto'];

/**
 * Config schema. `mode` is volatile so `settings.update` can flip it without remounting the row
 * (same pattern as dsh-agent-default-model's provider/model). Everything else is the row's ordinary
 * config -- undeclared fields would be stripped once a schema exists, so all of them stay here.
 */
export const Config = z.object({
  mode: z.union(MODES).default('auto').volatile(),
  auto: z.boolean(),
  judge: z.boolean(),
  routes: z.any(),
  tiers: z.any(),
  global: z.boolean(),
  baseUrl: z.string().default(DEFAULT_JUDGE_BASE_URL),
  model: z.string().default(DEFAULT_JUDGE_MODEL),
  credentialRef: z.string().default(DEFAULT_CREDENTIAL_REF),
  timeoutMs: z.number().default(JUDGE_TIMEOUT_MS),
});

/**
 * The loader entry id that owns this plugin's Config. It is not stable across install paths:
 * a hand-patched row uses `router-neohorse`, while a bundle insert uses `include:router-neohorse`,
 * and `settings.update` addresses entries by that id (not by package name). Empty input falls back
 * so callers can still attempt a write and surface a precise 503.
 */
export function resolveModeEntryId(entries, fallback = MODE_NS) {
  for (const entry of entries ?? []) {
    const options = entry !== undefined && entry !== null ? entry.options : undefined;
    if (options !== undefined && options !== null && options.name === 'dsh-router-neohorse'
      && typeof options.id === 'string' && options.id !== '') return options.id;
  }
  return fallback;
}

/** Loader entries for the running row, or []. Never throws -- read paths stay fail-safe. */
function loaderEntries(ctx) {
  try {
    const loader = ctx !== undefined && ctx !== null ? ctx.loader : undefined;
    if (loader !== undefined && loader !== null && typeof loader.entries === 'function') {
      return [...loader.entries()];
    }
  } catch { /* fall through */ }
  return [];
}

/**
 * The mode in force for the next request: the settings value when available, else the mount-time
 * fallback. Never throws -- a settings plane that rejects the read must not take routing down with it
 * (the same fail-safe posture as every other path in this file).
 *
 * Two settings APIs exist in the wild and both are read: SettingsForms (dsh >= 0.1.7) exposes
 * `describe()` only; the older SettingsProvider exposes `get(ns)` (and `installSection`). Live value
 * is required because a volatile update does not remount, so the `config` object apply() received
 * goes stale after the first flip.
 */
export function currentMode(ctx, fallback) {
  try {
    const settings = ctx !== undefined && ctx !== null ? ctx.get('settings') : undefined;
    if (settings === undefined || settings === null) return fallback;
    const ns = resolveModeEntryId(loaderEntries(ctx), MODE_NS);
    if (typeof settings.describe === 'function') {
      const row = settings.describe().find((candidate) => candidate !== undefined && candidate.ns === ns);
      const mode = row !== undefined && row !== null && row.value !== undefined && row.value !== null
        ? row.value.mode : undefined;
      if (MODES.includes(mode)) return mode;
    }
    if (typeof settings.get === 'function') {
      for (const id of ns === MODE_NS ? [ns] : [ns, MODE_NS]) {
        const section = settings.get(id);
        const mode = section !== undefined && section !== null ? section.mode : undefined;
        if (MODES.includes(mode)) return mode;
      }
      return fallback;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** Whether a volatile mode write can succeed right now (entry + Config schema present). */
function modeWritable(ctx) {
  try {
    const settings = ctx !== undefined && ctx !== null ? ctx.get('settings') : undefined;
    if (settings === undefined || settings === null) return false;
    if (typeof settings.update !== 'function') return false;
    const entries = loaderEntries(ctx);
    if (resolveModeEntryId(entries, null) === null) return false;
    if (typeof settings.describe === 'function') {
      const ns = resolveModeEntryId(entries, MODE_NS);
      return settings.describe().some((row) => row !== undefined && row.ns === ns);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish the mode as a settings namespace so a client can switch it at runtime.
 *
 * Returns the `settings` service, or null when this composition serves no settings plane. Deliberately
 * its own try/catch and its own lazy import: schemastery ships as a peer the profile provides, so a
 * deployment without it loses the *switch*, never the routing -- `currentMode` then falls back to the
 * mount-time value, which is the old behaviour.
 *
 * `onChange` is what makes the switch live: `installSection` hands back the newly composed section on
 * every commit, and the auto path reads that value per request (see the `agent/request` listener).
 */
async function installModeSetting(ctx, fallback, sink) {
  try {
    const settings = ctx.get('settings');
    if (settings === undefined || settings === null) return null;
    if (typeof settings.installSection !== 'function') return null;
    const schema = z.object({
      mode: z.union(MODES).default(fallback),
    });
    settings.installSection(ctx, MODE_NS, schema, { mode: fallback }, {
      setSource: (source) => {
        try {
          const value = typeof source === 'function' ? source() : source;
          if (value !== undefined && value !== null && MODES.includes(value.mode)) sink.mode = value.mode;
        } catch { /* keep mount-time sink */ }
      },
      onChange: (section) => {
        if (section !== undefined && section !== null && MODES.includes(section.mode)) sink.mode = section.mode;
      },
    });
    return settings;
  } catch (error) {
    log(`mode setting unavailable (${error.message}) -- the switch is off, routing is unchanged`);
    return null;
  }
}

/**
 * Serve the tier chip's mode switch over the web carrier, same-origin.
 *
 * The chip is a *static* client bundle, so it has no `host.call` (that is a dynamic-Package private RPC)
 * and it cannot reach `settings` either. A same-origin route is the one channel both sides already have:
 * the browser fetches this origin, so no CORS is involved, and the write happens here in the host realm
 * where the settings service accepts an ordinary object literal.
 *
 *   GET  -> `{mode}` so the chip can render the current mode
 *   POST -> `{mode}` to switch, body `{"mode":"auto"|"manual"}`
 *
 * The disposer goes through `ctx.effect`: a `webServer.register` disposer nobody keeps leaks the path for
 * the life of the process, and a later registration then fails with "duplicate exact route".
 */
function installModeRoute(ctx, sink) {
  // `ctx.inject`, NOT a bare `ctx.get`: this row mounts during boot, and `webServer` may not have
  // registered yet at apply() time. A `ctx.get` that misses returns undefined, the guard below returns,
  // and the route is simply never served -- no error, no log, a 404 forever. `inject` runs the callback
  // when the service arrives instead. The official provider packages use the same shape.
  ctx.inject(['webServer'], (scoped) => {
  const webServer = scoped.get('webServer');
  if (webServer === undefined || webServer === null) return;
  scoped.effect(() => webServer.register({
    kind: 'exact',
    path: '/router-neohorse/mode',
    handler: (req, res) => {
      const send = (code, body) => {
        const text = JSON.stringify(body);
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(Buffer.byteLength(text)));
        res.end(text);
      };
      if (req.method === 'GET') {
        send(200, { mode: currentMode(ctx, sink.mode), writable: modeWritable(ctx) });
        return;
      }
      if (req.method !== 'POST') {
        send(405, { error: 'method not allowed' });
        return;
      }
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; if (raw.length > 4096) req.destroy(); });
      req.on('end', () => {
        Promise.resolve().then(async () => {
          let wanted = null;
          try {
            wanted = JSON.parse(raw).mode;
          } catch {
            send(400, { error: 'body must be json', writable: modeWritable(ctx) });
            return;
          }
          if (!MODES.includes(wanted)) {
            send(400, { error: `mode must be one of ${MODES.join('|')}`, writable: modeWritable(ctx) });
            return;
          }
          const settings = ctx.get('settings');
          if (settings === undefined || settings === null || typeof settings.update !== 'function') {
            send(503, { error: 'settings unavailable', writable: false });
            return;
          }
          const ns = resolveModeEntryId(loaderEntries(ctx), MODE_NS);
          try {
            await settings.update(ns, { mode: wanted });
          } catch (error) {
            // Wrong entry id, missing Config schema, or a non-volatile field: all mean the write
            // cannot land, so answer 503 with the reason instead of a bare 500 the chip ignores.
            const message = String(error && error.message ? error.message : error);
            send(503, { error: message, writable: false });
            return;
          }
          // Volatile updates do not remount: keep the mount-time sink in sync for the fallback read.
          sink.mode = wanted;
          send(200, { mode: currentMode(ctx, wanted), writable: modeWritable(ctx) });
        }).catch((error) => {
          send(500, { error: String(error && error.message ? error.message : error) });
        });
      });
    },
  }));
  });
}

/**
 * Serve the tier chip's judgment log over the web carrier, same-origin.
 *
 * The remote judge keeps no local service, so the host half owns the in-memory history the chip
 * polls (the old Python `/state` server is gone).
 *
 *   GET -> `{sessions: { <sessionId>: [{ts, tier, triggered_by, task}] }}`
 */
function installStateRoute(ctx, state) {
  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.get('webServer');
    if (webServer === undefined || webServer === null) return;
    scoped.effect(() => webServer.register({
      kind: 'exact',
      path: '/router-neohorse/state',
      handler: (req, res) => {
        const text = JSON.stringify(state.read());
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(Buffer.byteLength(text)));
        res.end(text);
      },
    }));
  });
}

/**
 * Tier -> route for AUTO mode (plugin v2, docs/plugin-v2-plan.md §3.3).
 *
 * Deliberately a different table from ROUTE_TABLE: v2 is the product path (none -> tier via the
 * System One judge), while ROUTE_TABLE serves the v1 judge path (hard -> qwen
 * xhigh). The two stay separate so experiment baselines remain comparable. `max` is legal on
 * deepseek-official -- the adapter's `resolveThinking` accepts off|low|high|max (verified in the
 * dsh-llm-deepseek source). A preset re-points rows via its own `tiers` config, mirroring
 * `cfg.routes`.
 */
export const TIER_TABLE = {
  low: { provider: DEFAULT_PROVIDER, model: 'deepseek-flash', effort: 'low' },
  high: { provider: DEFAULT_PROVIDER, model: 'deepseek-flash', effort: 'high' },
  max: { provider: DEFAULT_PROVIDER, model: 'deepseek-flash', effort: 'max' },
  fallback: { provider: DEFAULT_PROVIDER, model: 'deepseek-flash', effort: 'low' },
};

/**
 * Parse one arm as `[provider/]model[:effort]`.
 *
 * Returns null for an empty spec, and throws on a structurally malformed one rather than running a
 * wrong arm -- a typo in a *provider* or *model* would otherwise quietly produce a whole run of
 * mislabelled results.
 *
 * The effort level is deliberately NOT validated against a list here. Effort is an adapter-owned
 * vocabulary and every route spells it differently -- `deepseek-official` accepts `off|low|high|max`,
 * `qwen-token-plan-cn` accepts `low|medium|xhigh` -- so a hardcoded list in this file rejects valid
 * levels on every model it was not written for. An unusable level fails loudly at the adapter one
 * step later (a QUOTA/INVALID code in the session log), which is the same fail-loud property without
 * owning a vocabulary this plugin does not define.
 */
export function parseArm(spec) {
  if (spec === undefined || spec === null || String(spec).trim() === '') return null;
  const text = String(spec).trim();
  const colon = text.lastIndexOf(':');
  const head = colon === -1 ? text : text.slice(0, colon);
  const effort = colon === -1 ? undefined : text.slice(colon + 1);
  if (effort !== undefined && effort === '') {
    throw new Error(`ROUTEEXP_ARM "${text}" has a trailing colon with no effort`);
  }
  const slash = head.indexOf('/');
  const provider = slash === -1 ? DEFAULT_PROVIDER : head.slice(0, slash);
  const model = slash === -1 ? head : head.slice(slash + 1);
  if (!provider || !model) throw new Error(`ROUTEEXP_ARM "${text}" has an empty provider or model`);
  return { provider, model, effort };
}

/**
 * Parse `ROUTEEXP_ARM` as a comma-separated arm schedule: null when unset, one entry for a constant
 * arm, more for a per-request cycle. The literal `judge` is not an arm -- it selects the judge layer.
 */
export function parseSchedule(spec) {
  if (spec === undefined || spec === null || String(spec).trim() === '') return null;
  const arms = String(spec).split(',').map((s) => parseArm(s));
  if (arms.some((a) => a === null)) throw new Error(`ROUTEEXP_ARM "${spec}" has an empty arm`);
  return arms;
}

/** The one place a mode literal replaces the env var. `auto` is checked before parseSchedule so a
 * malformed arm elsewhere in the spec still throws loud (deepseek review F13). */
export function resolveSchedule() {
  const spec = process.env.ROUTEEXP_ARM;
  const text = spec === undefined ? '' : String(spec).trim().toLowerCase();
  if (text === 'judge') return 'judge';
  if (text === 'auto') return 'auto';
  return parseSchedule(spec);
}

/**
 * Map a judge answer onto a route. Anything unrecognised takes that table's fallback column.
 *
 * `table` defaults to the built-in one, which keeps the level -> route mapping a pure function the
 * tests can drive, while a preset row can re-point it from its own config.
 */
export function routeForLevel(level, table = ROUTE_TABLE) {
  const key = typeof level === 'string' ? level.trim().toLowerCase() : '';
  return table[key] || table.fallback;
}

/**
 * Apply one route to a request config.
 *
 * `maxTokens` is dropped: it reaches this seam already defaulted by the *previous* route's adapter
 * (flagged as an adapter default in the request header), so keeping it would pin one adapter's cap
 * onto another model.
 */
export function applyRoute(config, route) {
  const out = { ...config, provider: route.provider, model: route.model };
  delete out.maxTokens;
  if (route.effort === undefined) delete out.reasoningEffort;
  else out.reasoningEffort = route.effort;
  return out;
}

/**
 * Whether the mounted adapters can actually serve one route.
 *
 * A table entry naming a provider this profile never registered would replace the user's model with
 * an unroutable one and fail the step, so the judge path checks the live registry first. Only the
 * PROVIDER is checked, and deliberately not the effort: effort is adapter-owned vocabulary (see
 * `parseArm`), and re-owning it here is exactly the bug that comment already records.
 *
 * Returns null when the route cannot be served, which leaves the request on the config its own owner
 * chose. The cycling arm path is NOT guarded -- there a wrong arm has to stay loud.
 */
export function usableRoute(ctx, route) {
  // null and undefined both mean "no route to apply". A row config that nulls the fallback column
  // (`routes: { fallback: }`) would otherwise reach `applyRoute` as undefined and throw on the step.
  if (route === undefined || route === null) return null;
  const llm = ctx.get('llm');
  if (llm === undefined) return route;
  let providers;
  try {
    providers = llm.listProviders();
  } catch {
    return route;
  }
  if (providers.some((p) => p.id === route.provider)) return route;
  log(`route ${route.provider}/${route.model} names a provider this profile has not registered`
    + ' -- leaving the request on its own config');
  return null;
}

/**
 * Whether an incoming config already names a route its owner chose.
 *
 * The loop seeds a request from the agent's own options, so a config that carries an explicit
 * `reasoningEffort` is an agent that was told what to use -- a `subagent` call with
 * `reasoning_effort`, for instance. Rewriting it would silently discard that choice.
 */
export function carriesExplicitRoute(config) {
  return config !== undefined && config !== null && config.reasoningEffort !== undefined;
}

/**
 * Whether the explicit effort on this config is the route WE applied last turn (plugin v2.1).
 *
 * `carriesExplicitRoute` alone cannot tell a delegated choice from our own footprint: the route
 * this plugin applies becomes the session's config, so from the second request on every turn
 * looks "explicit" and auto mode locks itself to one routing per agent (live-verified 2026-09-25,
 * two independent causes: the global `agent-default-model.reasoningEffort` seeds every request,
 * and our own writes re-read as explicit). The session state knows what we served last -- if the
 * config matches it, it is ours and MUST be re-routed (that is the whole point of auto); anything
 * else (subagent delegation, a user-pinned effort) stays deferred.
 */
export function isOurRoute(config, state, tiers = TIER_TABLE) {
  if (config === undefined || config === null || config.reasoningEffort === undefined) return false;
  if (state === undefined || state.tier === undefined) return false;
  const ours = tiers[state.tier];
  if (ours === undefined) return false;
  return config.reasoningEffort === ours.effort && config.model === ours.model;
}

function routeLabel(route) {
  return `${route.provider}/${route.model} effort=`
    + `${route.effort === undefined ? 'adapter default' : route.effort}`;
}

function log(message) {
  process.stderr.write(`[router-neohorse] ${message}\n`);
}

/** Flatten one message's text blocks; returns '' when it carries none. */
function textOf(message) {
  return (message && message.content ? message.content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Ask the System One judge (HTTP) for one difficulty level (v1 / `judge` mode).
 *
 * The judge is a remote decision call to the TokenRhythm System One endpoint with the
 * NeoHorse-Jev-4B model, not a local process. Every failure path returns null and the caller
 * falls back to the route table's fallback column.
 */
export function systemOneDifficultyRequest(cfg, taskText) {
  return {
    model: cfg.model || DEFAULT_JUDGE_MODEL,
    state: { task: taskText.slice(0, JUDGE_MAX_CHARS) },
    questions: {
      difficulty: {
        type: 'choice',
        instructions: 'Rate the difficulty of this task. Answer with exactly one option id.',
        criteria: {
          easy: 'trivial, simple, or routine; little reasoning needed',
          medium: 'moderate complexity; careful work needed',
          hard: 'complex, long, or high-stakes; deep reasoning needed',
        },
      },
    },
  };
}

/** Parse the System One difficulty answer (v1), or null for every failure. */
export function parseSystemOneDifficultyAnswer(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const answers = raw.answers;
  if (answers === null || typeof answers !== 'object') return null;
  const choice = answers.difficulty === null || typeof answers.difficulty !== 'object'
    ? null : answers.difficulty.choice;
  return choice === 'easy' || choice === 'medium' || choice === 'hard' ? choice : null;
}

/**
 * Ask the System One judge (HTTP) for one difficulty level (v1 / `judge` mode).
 *
 * Every failure path returns null and the caller falls back.
 */
export async function judgeDifficulty(ctx, cfg, taskText, sessionId, signal) {
  if (taskText === null || taskText === '') return null;
  const key = await resolveCredential(ctx, cfg);
  if (key === null) return null;
  const timeout = AbortSignal.timeout(cfg.timeoutMs || JUDGE_TIMEOUT_MS);
  if (signal !== undefined && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', () => timeout.abort?.(), { once: true });
  }
  try {
    const res = await fetch(cfg.baseUrl || DEFAULT_JUDGE_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(systemOneDifficultyRequest(cfg, taskText)),
      signal: timeout,
    });
    if (!res.ok) {
      log(`judge HTTP ${res.status}`);
      return null;
    }
    const level = parseSystemOneDifficultyAnswer(await res.json());
    if (level === null) log(`judge returned no usable difficulty`);
    return level;
  } catch (e) {
    log(`judge call failed: ${e.message}`);
    return null;
  }
}

/**
 * Build the System One tier-judgment request (AUTO mode, plugin v2).
 *
 * Pure, so tests drive the wire contract without a network. The current task text plus the
 * session's previous tier and task text go into `state`; two choice questions ask for the tier
 * and the reason, and the model's instructions carry the product policy (explicit intent wins,
 * retry escalates, exclusions cap, otherwise content difficulty).
 */
export function systemOneTierRequest(cfg, taskText, prevTier, prevTask, sessionId) {
  return {
    model: cfg.model || DEFAULT_JUDGE_MODEL,
    state: {
      task: taskText.slice(0, JUDGE_MAX_CHARS),
      prev_tier: prevTier === undefined ? null : prevTier,
      prev_task: prevTask === undefined ? null : prevTask,
      session_id: sessionId === undefined ? null : sessionId,
    },
    questions: {
      tier: {
        type: 'choice',
        instructions: 'Classify how much reasoning this task needs. Policy: an explicit user tier '
          + 'demand wins; a task that repeats the previous task text (a retry) escalates one level; '
          + 'a stated exclusion caps the tier; otherwise judge content difficulty. '
          + 'Answer with exactly one option id.',
        criteria: {
          low: 'simple, chatty, or routine task; little reasoning needed',
          high: 'moderate complexity; careful work and verification needed',
          max: 'hard task, a retry that already failed, or the user explicitly demands the highest tier',
        },
      },
      reason: {
        type: 'choice',
        instructions: 'Why this tier? Answer with exactly one option id.',
        criteria: {
          content: 'content-based difficulty',
          intent_force: 'the user explicitly demands the highest tier',
          intent_inherit: 'the user says continue; keep the previous tier',
          intent_exclude: 'the user excluded a tier',
          escalate_regenerate: 'the task text repeats the previous task (retry); escalate',
        },
      },
    },
  };
}

/** Parse the System One tier answer into `{tier, triggered_by}`, or null for every failure. */
export function parseSystemOneTierAnswer(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const answers = raw.answers;
  if (answers === null || typeof answers !== 'object') return null;
  const tier = answers.tier === null || typeof answers.tier !== 'object' ? null : answers.tier.choice;
  if (typeof tier !== 'string' || !TIER_OPTIONS.includes(tier)) return null;
  const reason = answers.reason === null || typeof answers.reason !== 'object' ? null : answers.reason.choice;
  const triggeredBy = typeof reason === 'string' && REASON_OPTIONS.includes(reason) ? reason : 'content';
  return { tier, triggered_by: triggeredBy, labels: null };
}

/**
 * Resolve the judge API key through DSH's `credentials` service by reference.
 *
 * The plugin never reads the key itself -- the service returns it at runtime, and a missing or
 * unset reference falls back to null so the caller keeps the low tier (fail-safe, never a break).
 */
async function resolveCredential(ctx, cfg) {
  const credentials = ctx !== undefined && ctx !== null ? ctx.get('credentials') : undefined;
  const ref = cfg.credentialRef || DEFAULT_CREDENTIAL_REF;
  if (credentials === undefined || credentials === null || typeof credentials.resolve !== 'function') {
    log(`credentials service unavailable; the judge needs credentialRef ${ref}`);
    return null;
  }
  try {
    const entry = await credentials.resolve(ref);
    const value = entry !== undefined && entry !== null && typeof entry === 'object' ? entry.value : entry;
    if (value === undefined || value === null || value === '') {
      log(`credentialRef ${ref} is not set -- judge falls back to low`);
      return null;
    }
    return String(value);
  } catch (error) {
    log(`credential resolve failed: ${error && error.message ? error.message : error}`);
    return null;
  }
}

/**
 * Ask the System One judge (HTTP) for one tier (AUTO mode, plugin v2).
 *
 * The request carries the current task text plus the session's previous tier and task text so the
 * model applies the full product policy; the response supplies `{tier, triggered_by}`. Every failure
 * path returns null and the caller applies TIER_TABLE.fallback (deepseek review F2: "never break the
 * session" means the fallback ROUTE here; a route the profile cannot serve is handled separately by
 * `usableRoute`).
 */
export async function judgeTier(ctx, cfg, taskText, prevTier, prevTask, sessionId, signal) {
  if (taskText === null || taskText === '') return null;
  const key = await resolveCredential(ctx, cfg);
  if (key === null) return null;
  const timeout = AbortSignal.timeout(cfg.timeoutMs || JUDGE_TIMEOUT_MS);
  if (signal !== undefined && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', () => timeout.abort?.(), { once: true });
  }
  try {
    const res = await fetch(cfg.baseUrl || DEFAULT_JUDGE_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(systemOneTierRequest(cfg, taskText, prevTier, prevTask, sessionId)),
      signal: timeout,
    });
    if (!res.ok) {
      log(`judge HTTP ${res.status}`);
      return null;
    }
    const parsed = parseSystemOneTierAnswer(await res.json());
    if (parsed === null) log(`judge returned no usable tier`);
    return parsed;
  } catch (e) {
    log(`judge call failed: ${e.message}`);
    return null;
  }
}

/**
 * Pure session-state transition for AUTO mode, exported for offline tests.
 *
 * `state` is the previous `{ tier, task, turn }` (undefined on turn 1); `judgment` is the
 * judgeTier result or null. Turn went BACKWARDS (session reset / id reuse) -> the state is
 * discarded (deepseek review F4: a stale prev_tier/prev_task must not leak into a fresh
 * conversation). A failed judgment keeps the route policy's tier (the fallback we actually
 * served) but always advances the stored task text -- the next turn's regenerate check compares
 * against what the user last asked, judged or not.
 */
export function nextSessionState(state, turn, taskText, judgment) {
  const reused = state !== undefined && state.turn !== undefined
    && turn !== undefined && turn < state.turn;
  const base = reused ? undefined : state;
  const tier = judgment !== null
    ? judgment.tier
    : (base !== undefined && base.tier !== undefined ? base.tier : 'low');
  return { tier, task: taskText, turn };
}

/**
 * Bring the judge up, then wait for it to answer. Never throws.
 *
 * The judge is remote (TokenRhythm System One): mounting the row IS starting it, so this returns
 * the ready message immediately. Returns a short human-readable outcome for the log; the caller
 * ignores it.
 */
export async function ensureJudgeService(cfg) {
  return `remote judge ready (${cfg.model || DEFAULT_JUDGE_MODEL} @ ${cfg.baseUrl || DEFAULT_JUDGE_BASE_URL}); no local service needed`;
}

export function apply(ctx, config) {
  const cfg = config !== null && typeof config === 'object' ? config : {};
  // The judge/auto mode is normally selected by `ROUTEEXP_ARM=judge|auto`, the experiment's own
  // control surface. A row config selects it instead (`judge: true` / `auto: true`), which is how
  // a preset turns routing on with no environment variable at all: the preset IS the switch.
  const spec = cfg.auto === true ? 'auto' : cfg.judge === true ? 'judge' : resolveSchedule();
  if (spec === null) {
    log('no arm configured -- leaving every route untouched');
    return;
  }

  const respectExplicit = process.env.ROUTEEXP_RESPECT_EXPLICIT === '1';
  const judging = spec === 'judge';
  const auto = spec === 'auto';
  const schedule = judging || auto ? null : spec;
  const constant = judging || auto || schedule.length === 1;
  // Where a level -> route policy belongs: the row that wants a different one states it, and the
  // built-in table stays the default the experiment measures.
  const table = { ...ROUTE_TABLE, ...(cfg.routes || {}) };
  const tiers = { ...TIER_TABLE, ...(cfg.tiers || {}) };
  // `{ global: true }` covers every session in the process, which is what the experiment's arm
  // selector needs at the host plane. A preset row is already scoped to its own agents and must NOT
  // be global -- that would let one Auto session re-route another session's requests.
  const useGlobal = cfg.global !== false;
  /**
   * The mode read for the *next* request. `installModeSetting` overwrites `mode` on every settings
   * commit, so this is a live value; until the registration lands (or in a composition with no
   * settings plane) it stays at the mount-time mode, which is the pre-switch behaviour.
   */
  const modeSink = { mode: auto ? 'auto' : 'manual' };
  /** True when the user switched to manual: leave the request on the config its own owner chose. */
  const isManual = () => currentMode(ctx, modeSink.mode) === 'manual';
  /** In-memory judgment history served to the tier chip (the remote judge keeps no local service). */
  const judgeLog = [];
  let lastJudgmentOk = true;
  const judgeState = {
    read() {
      const sessions = {};
      for (const row of judgeLog) {
        (sessions[row.sessionId] ||= []).push(row);
      }
      return { sessions, available: lastJudgmentOk };
    },
  };

  if (auto) {
    log(`auto tier per turn; tiers low=${routeLabel(tiers.low)} `
      + `high=${routeLabel(tiers.high)} max=${routeLabel(tiers.max)} `
      + `fallback=${routeLabel(tiers.fallback)}`);
    // The judge is remote (TokenRhythm System One), so there is no local service to bring up; this
    // logs the ready state without blocking boot, and `judgeTier` fails safe per turn anyway.
    Promise.resolve()
      .then(() => ensureJudgeService(cfg))
      .then((outcome) => { log(`judge service: ${outcome}`); })
      .catch((e) => { log(`judge service: ready check skipped (${e.message})`); });
    // The runtime switch. Not awaited either: registering it must not delay the row, and the read
    // path already falls back to `modeFallback` until the registration lands.
    installModeSetting(ctx, 'auto', modeSink).then((settings) => {
      if (settings !== null) log(`mode switch ready (${MODE_NS}.mode, default auto)`);
    });
    // The chip's side of the same switch: a same-origin route, because a static client bundle has no
    // `host.call` and no `ctx.remote.settings`.
    installModeRoute(ctx, modeSink);
    installStateRoute(ctx, judgeState);
  } else if (judging) {
    log(`judging every turn; table easy=${routeLabel(table.easy)} `
      + `hard=${routeLabel(table.hard)} fallback=${routeLabel(table.fallback)}`);
    installStateRoute(ctx, judgeState);
  } else {
    log(constant
      ? `forcing every request to ${routeLabel(schedule[0])}`
      : `cycling ${schedule.length} arms per request: ${schedule.map(routeLabel).join(' | ')}`);
  }
  if (respectExplicit) log('deferring to any request that already names a reasoning effort');

  // Request index per session, so a cycle is per session rather than per process: concurrent runs
  // would otherwise share one counter and land on unpredictable arms.
  const counts = new Map();
  /** session key -> { turn, route } -- the verdict already applied to that turn; route null means
   * "no route this profile can serve", cached so one turn does not re-ask on every step. */
  const verdicts = new Map();
  /** session key -> the newest claimed user text, so every turn is judged on its own prompt. */
  const tasks = new Map();
  /** session key -> { tier, task, turn } -- AUTO-mode session state written at the END of a turn:
   * the tier we served and the task text we served it for, feeding the next turn's
   * prev_tier/prev_task (regenerate detection + C3 escalation). */
  const sessionState = new Map();
  const keyOf = (payload) => {
    const session = payload && payload.agent && payload.agent.session;
    return (session && (session.id || session.sessionId)) || 'global';
  };

  if (judging || auto) {
    // The task text is captured HERE, not at `agent/request`. Measured on a live session, the surface
    // at request time holds only [permission/preset, sandbox/mode, approval/policy,
    // agent/inbox/spliced, turn/start, agent/inbox/spliced, step/start] and `inbox.nextTurn` is
    // already empty -- the user's own message is not observable from the request seam at all.
    // `agent/inbox/claimed` fires as that message leaves the inbox, which is the last moment it can be
    // read, so each prompt is remembered against its session and judged on the way out.
    //
    // OVERWRITTEN, not kept. Judging the session once and locking it to its first prompt would pin a
    // conversation that opens with chitchat to the chitchat tier for the rest of its life.
    ctx.on('agent/inbox/claimed', (payload) => {
      const key = keyOf(payload);
      const text = textOf(payload && payload.message);
      if (text === '') return;
      tasks.set(key, {
        text: text.slice(0, JUDGE_MAX_CHARS),
        sessionId: payload && payload.agent && payload.agent.session && payload.agent.session.id,
      });
    }, { global: useGlobal });
  }

  ctx.on('agent/request', async (payload, next) => {
    const config = await next();
    const key = keyOf(payload);
    // The runtime switch, read HERE so flipping it takes effect on the next model call rather than at
    // the next restart. Manual means exactly what it says: the request keeps the config its own owner
    // chose, and nothing below runs.
    if (auto && isManual()) {
      return config;
    }
    if (respectExplicit && carriesExplicitRoute(config)) {
      // v2.1: in auto mode, an explicit effort that matches what WE served this session is our
      // own footprint -- re-route it (that is the whole point of auto). Anything foreign
      // (subagent delegation, a pinned default) still defers. v1 paths keep the blanket defer.
      if (auto && isOurRoute(config, sessionState.get(key), tiers)) {
        log('explicit effort is our own last applied route -- re-routing');
      } else {
        log('request already names a reasoning effort -- deferring');
        return config;
      }
    }
    if (auto) {
      // AUTO (plugin v2): the current task text comes from `tasks` (claimed this turn); the
      // previous tier/task come from `sessionState` (written at the END of the previous turn) --
      // two maps with two writers, deliberately (deepseek review F7). Same per-turn caching as
      // the judge path; the state map carries `turn` so a session reset / id reuse (turn going
      // backwards) discards stale prev_tier/prev_task instead of leaking them (deepseek F4).
      const turn = payload && payload.turn;
      const cached = verdicts.get(key);
      if (cached !== undefined && cached.turn === turn) {
        return cached.route === null ? config : applyRoute(config, cached.route);
      }
      const task = tasks.get(key);
      const prev = sessionState.get(key);
      const state = prev !== undefined && (turn === undefined || prev.turn === undefined || turn >= prev.turn)
        ? prev
        : undefined;
      const judgment = task === undefined
        ? null
        : await judgeTier(ctx, cfg, task.text, state ? state.tier : undefined, state ? state.task : undefined,
          task.sessionId, payload && payload.signal);
      // Fail-safe, two branches (plan §4.4): /judge unreachable -> the fallback ROUTE (low);
      // a route this profile cannot serve -> leave the request on its own config (usableRoute
      // returns null, v1 semantics -- NOT the fallback).
      let route;
      let servedTier;
      if (judgment === null) {
        route = usableRoute(ctx, tiers.fallback);
        servedTier = 'low';
      } else {
        route = usableRoute(ctx, tiers[judgment.tier] || tiers.fallback);
        servedTier = judgment.tier;
      }
      verdicts.set(key, { turn, route });
      if (task !== undefined) {
        sessionState.set(key, { tier: servedTier, task: task.text, turn });
      }
      judgeLog.push({
        ts: Math.floor(Date.now() / 1000),
        sessionId: key,
        tier: servedTier,
        triggered_by: judgment === null ? '' : judgment.triggered_by,
        task: (task === undefined ? '' : task.text).slice(0, 30),
      });
      if (judgeLog.length > 200) judgeLog.splice(0, judgeLog.length - 200);
      lastJudgmentOk = judgment !== null;
      log(`turn ${turn} auto "${task === undefined ? '(no task text captured)' : task.text.slice(0, 60).replace(/\s+/g, ' ')}"`
        + ` -> ${judgment === null ? 'judge unreachable -> fallback' : `${judgment.tier} (${judgment.triggered_by})`} -> `
        + (route === null ? 'left on its own config' : routeLabel(route)));
      return route === null ? config : applyRoute(config, route);
    }
    if (judging) {
      const turn = payload && payload.turn;
      const cached = verdicts.get(key);
      // One judgment per TURN, held across every step of it. An agentic turn makes many model calls,
      // and a tier that moved mid-turn would fight both the KV cache and the tool calls already in
      // flight -- so this is "route each task once", not "route every tool-call round".
      if (cached !== undefined && cached.turn === turn) {
        return cached.route === null ? config : applyRoute(config, cached.route);
      }
      const task = tasks.get(key);
      const level = task === undefined
        ? null
        : await judgeDifficulty(ctx, cfg, task.text, task.sessionId, payload && payload.signal);
      const route = usableRoute(ctx, routeForLevel(level, table));
      verdicts.set(key, { turn, route });
      const levelTier = level === 'hard' ? 'max' : level === 'medium' ? 'high' : 'low';
      judgeLog.push({
        ts: Math.floor(Date.now() / 1000),
        sessionId: key,
        tier: levelTier,
        triggered_by: level === null ? '' : 'content',
        task: (task === undefined ? '' : task.text).slice(0, 30),
      });
      if (judgeLog.length > 200) judgeLog.splice(0, judgeLog.length - 200);
      lastJudgmentOk = level !== null;
      log(`turn ${turn} judged "${task === undefined ? '(no task text captured)' : task.text.slice(0, 60).replace(/\s+/g, ' ')}"`
        + ` -> ${level === null ? 'unjudged' : level} -> `
        + (route === null ? 'left on its own config' : routeLabel(route)));
      return route === null ? config : applyRoute(config, route);
    }
    const index = counts.get(key) || 0;
    counts.set(key, index + 1);
    const route = schedule[index % schedule.length];
    if (!constant) {
      process.stderr.write(`[router-neohorse] request #${index} (turn ${payload && payload.turn}, step `
        + `${payload && payload.step}) -> ${routeLabel(route)}\n`);
    }
    return applyRoute(config, route);
  }, { global: useGlobal });
}
