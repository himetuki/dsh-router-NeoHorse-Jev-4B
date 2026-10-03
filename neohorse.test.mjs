// NeoHorse System One wire checks: the request builders and answer parsers, offline and pure.
//
//     node neohorse.test.mjs
import { parseSystemOneDifficultyAnswer, parseSystemOneTierAnswer, systemOneDifficultyRequest,
  systemOneTierRequest } from './index.js';

let pass = 0;
const fail = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const cfg = { model: 'NeoHorse-Jev-4B' };

// systemOneTierRequest: model, state (task capped, undefined prev -> null), two choice questions.
const req = systemOneTierRequest(cfg, '帮我优化一下', 'low', '帮我优化一下', 's1');
check('tier request model', req.model, 'NeoHorse-Jev-4B');
check('tier request state', req.state, {
  task: '帮我优化一下', prev_tier: 'low', prev_task: '帮我优化一下', session_id: 's1',
});
check('tier request questions', Object.keys(req.questions).sort(), ['reason', 'tier']);
check('tier question type', req.questions.tier.type, 'choice');
check('tier options', Object.keys(req.questions.tier.criteria).sort(), ['high', 'low', 'max']);
check('reason options', Object.keys(req.questions.reason.criteria).sort(),
  ['content', 'escalate_regenerate', 'intent_exclude', 'intent_force', 'intent_inherit']);

const req2 = systemOneTierRequest(cfg, 'hi', undefined, undefined, undefined);
check('tier request undefined prev -> null', req2.state,
  { task: 'hi', prev_tier: null, prev_task: null, session_id: null });

const long = 'x'.repeat(5000);
check('tier request caps task', systemOneTierRequest(cfg, long, undefined, undefined, undefined).state.task.length, 4000);

// parseSystemOneTierAnswer
check('parse tier ok',
  parseSystemOneTierAnswer({ model: 'NeoHorse-Jev-4B', answers: { tier: { choice: 'high' }, reason: { choice: 'escalate_regenerate' } } }),
  { tier: 'high', triggered_by: 'escalate_regenerate', labels: null });
check('parse tier reason fallback content', parseSystemOneTierAnswer({ answers: { tier: { choice: 'low' } } }),
  { tier: 'low', triggered_by: 'content', labels: null });
check('parse tier unknown option -> null', parseSystemOneTierAnswer({ answers: { tier: { choice: 'ultra' } } }), null);
check('parse tier missing answers -> null', parseSystemOneTierAnswer({ model: 'x' }), null);
check('parse tier null -> null', parseSystemOneTierAnswer(null), null);

// systemOneDifficultyRequest / parse
const dreq = systemOneDifficultyRequest(cfg, '迁移 40 个测试文件');
check('difficulty request model', dreq.model, 'NeoHorse-Jev-4B');
check('difficulty question', Object.keys(dreq.questions), ['difficulty']);
check('difficulty options', Object.keys(dreq.questions.difficulty.criteria).sort(), ['easy', 'hard', 'medium']);
check('parse difficulty ok', parseSystemOneDifficultyAnswer({ answers: { difficulty: { choice: 'hard' } } }), 'hard');
check('parse difficulty unknown -> null', parseSystemOneDifficultyAnswer({ answers: { difficulty: { choice: 'ultra' } } }), null);
check('parse difficulty null -> null', parseSystemOneDifficultyAnswer(null), null);

console.log('='.repeat(70));
console.log(`  System One wire: ${pass} passed, ${fail.length} failed`);
console.log('='.repeat(70));
for (const line of fail) console.log('  FAIL ' + line);
process.exit(fail.length ? 1 : 0);
