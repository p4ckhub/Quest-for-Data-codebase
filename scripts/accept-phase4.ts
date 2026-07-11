// Phase 4 acceptance: Pointers & Memory (Zones 8-9) are real and measured.
// Core proof (spec §Phase 4 acceptance): a reference LEAKY solution's
// alloc_report measurably grows the Leak monster across 3 combat turns, and
// the corrected solution stops the growth. Plus: every Zone 8/9 lesson passes
// with its reference solution, the leakcheck shim's ledger is exact (allocs/
// frees/live_bytes), pass-by-value vs pass-by-reference is actually verified,
// and the Leak Tyrant encounter carries the §11.6 growth fields as content.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runLesson, Lesson } from '../runner/src/index';
import { createCombatState, writeCombatState, runCombatTurn, EnemyState } from '../runner/src/combat';
import { Spell } from '../runner/src/spellbook';

const BASE_DIR = path.join(__dirname, '..');
const ZONE_DIRS = ['mirror_realm', 'cursed_crypt'];

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

function loadLesson(rel: string): Lesson {
  return yaml.load(fs.readFileSync(path.join(BASE_DIR, rel), 'utf-8')) as Lesson;
}

function checkValue(r: any, id: string): any {
  return (r.events ?? []).find((e: any) => e.type === 'check' && e.id === id)?.value;
}

// Check 1: every Zone 8/9 lesson passes with its reference solution
async function checkReferenceSolutions(): Promise<CheckResult> {
  const failures: string[] = [];
  let count = 0;
  for (const dir of ZONE_DIRS) {
    const zonePath = path.join(BASE_DIR, 'content/zones/act1', dir);
    for (const file of fs.readdirSync(zonePath).sort()) {
      if (file.startsWith('encounter-')) continue;
      const lesson = loadLesson(`content/zones/act1/${dir}/${file}`);
      const r = await runLesson(lesson, (lesson as any).solution);
      count++;
      if (r.passed !== true) {
        failures.push(`${lesson.id}: error=${r.error} failed=${r.failedCheckIds}`);
      }
    }
  }
  return {
    name: 'Reference solutions (Zones 8-9)',
    passed: failures.length === 0,
    message: failures.length ? failures.join('; ') : `All ${count} lessons pass with reference solutions`
  };
}

// Check 2: the leakcheck shim's ledger is exact. The leaky starter of
// seal-the-rift must FAIL validation with live_bytes = 3 ints = 12 unfreed
// bytes and an alloc_report event; the corrected solution must show
// allocs=3 frees=3 live_bytes=0.
async function checkLeakLedger(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/cursed_crypt/zone-9-lesson-2.yaml') as any;

  const leaky = await runLesson(lesson, lesson.starter_code);
  if (leaky.passed === true || !(leaky.failedCheckIds ?? []).includes('live_bytes')) {
    return {
      name: 'Leak ledger (shim)',
      passed: false,
      message: `Leaky starter should fail check live_bytes: passed=${leaky.passed} failed=${leaky.failedCheckIds}`
    };
  }
  const leakedBytes = checkValue(leaky, 'live_bytes');
  const report = (leaky.events ?? []).find((e: any) => e.type === 'alloc_report');
  if (leakedBytes !== 12 || !report || report.live_bytes !== 12) {
    return {
      name: 'Leak ledger (shim)',
      passed: false,
      message: `3 leaked ints should read 12 live bytes: check=${leakedBytes} alloc_report=${JSON.stringify(report)}`
    };
  }

  const fixed = await runLesson(lesson, lesson.solution);
  if (fixed.passed !== true || checkValue(fixed, 'allocs') !== 3 || checkValue(fixed, 'frees') !== 3 || checkValue(fixed, 'live_bytes') !== 0) {
    return {
      name: 'Leak ledger (shim)',
      passed: false,
      message: `Fixed solution ledger wrong: passed=${fixed.passed} allocs=${checkValue(fixed, 'allocs')} frees=${checkValue(fixed, 'frees')} live=${checkValue(fixed, 'live_bytes')}`
    };
  }
  return {
    name: 'Leak ledger (shim)',
    passed: true,
    message: 'Leaky starter fails with 12 live bytes (checks + alloc_report agree); fix shows 3 allocs / 3 frees / 0 live'
  };
}

// Check 3: THE Phase 4 proof — the measured leak feeds the Leak monster.
// The leaky solution's live_bytes goes into the enemy state (the runner's
// §11.6 seam); across 3 harness turns the Tyrant must grow by exactly
// grow_hp_per_turn (from encounter content) each turn. The corrected
// solution's live_bytes (0) must stop the growth cold.
async function checkLeakMonsterGrowth(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/cursed_crypt/zone-9-lesson-2.yaml') as any;
  const enc = yaml.load(fs.readFileSync(
    path.join(BASE_DIR, 'content/zones/act1/cursed_crypt/encounter-leak-tyrant.yaml'), 'utf-8')) as any;
  const tyrant = enc.enemies[0];
  const grow = tyrant.grow_hp_per_turn;

  const leaky = await runLesson(lesson, lesson.starter_code);
  const fixed = await runLesson(lesson, lesson.solution);
  const scenarios = [
    { label: 'leaky', leak_bytes: checkValue(leaky, 'live_bytes'), expectGrowth: grow },
    { label: 'fixed', leak_bytes: checkValue(fixed, 'live_bytes'), expectGrowth: 0 },
  ];

  const outcomes: string[] = [];
  for (const s of scenarios) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept4-combat-'));
    try {
      const enemy: EnemyState = {
        id: 'tyrant-1', type: tyrant.type, hp: tyrant.hp, max_hp: tyrant.max_hp, statuses: [],
        attack: { min: tyrant.damage_formula.dice_min, max: tyrant.damage_formula.dice_max },
        leak_bytes: s.leak_bytes,
        grow_hp_per_turn: grow,
      };
      writeCombatState(dir, createCombatState('warrior', [enemy]));

      // No forged spell is cast: we isolate the growth mechanic from player damage.
      const spells: Spell[] = [];
      let hp = tyrant.hp;
      for (let turn = 1; turn <= 3; turn++) {
        const r = runCombatTurn(dir, 'unforged_gaze', spells);
        const after = (r.state.enemies[0] as any).hp;
        if (after !== hp + s.expectGrowth) {
          return {
            name: 'Leak feeds the monster',
            passed: false,
            message: `${s.label} run, turn ${turn}: hp ${hp} -> ${after}, expected ${hp + s.expectGrowth} (leak_bytes=${s.leak_bytes})`
          };
        }
        hp = after;
      }
      outcomes.push(`${s.label}: ${tyrant.hp} -> ${hp} over 3 turns`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    name: 'Leak feeds the monster',
    passed: true,
    message: `${outcomes.join('; ')} — growth ${grow}/turn comes from encounter content, leak_bytes from the measured run`
  };
}

// Check 4: pass-by-value vs pass-by-reference is actually enforced — taking
// both parameters by value must fail after_true (the blade never gleams).
async function checkByRefEnforced(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/mirror_realm/zone-8-lesson-3.yaml');
  const bothByValue = [
    'void polish_copy(int gleam) {',
    '    gleam += 50;',
    '}',
    'void polish_true(int gleam) {',
    '    gleam += 50;',
    '}',
  ].join('\n');
  const r = await runLesson(lesson, bothByValue);
  if (r.passed === true || !(r.failedCheckIds ?? []).includes('after_true')) {
    return {
      name: 'By-reference enforced',
      passed: false,
      message: `By-value polish_true should fail check after_true: passed=${r.passed} failed=${r.failedCheckIds}`
    };
  }
  return {
    name: 'By-reference enforced',
    passed: true,
    message: 'polish_true taken by value fails with failedCheckIds=[after_true]'
  };
}

// Check 5: the smart-pointer variant also leaves nothing alive (spec's
// "corrected solution (or smart-pointer variant) stops it")
async function checkSmartPointerVariant(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/cursed_crypt/zone-9-lesson-3.yaml') as any;
  const r = await runLesson(lesson, lesson.solution);
  if (r.passed !== true || checkValue(r, 'live_bytes') !== 0 || checkValue(r, 'allocs') !== 1) {
    return {
      name: 'Smart-pointer variant',
      passed: false,
      message: `unique_ptr lesson: passed=${r.passed} allocs=${checkValue(r, 'allocs')} live=${checkValue(r, 'live_bytes')}`
    };
  }
  return {
    name: 'Smart-pointer variant',
    passed: true,
    message: 'make_unique allocates once, frees itself, leaves 0 live bytes — no delete in player code'
  };
}

// Check 6: the Leak Tyrant encounter is combat-ready content with the §11.6
// growth fields declared in the YAML (formula in content, not engine code)
function checkTyrantEncounter(): CheckResult {
  const enc = yaml.load(fs.readFileSync(
    path.join(BASE_DIR, 'content/zones/act1/cursed_crypt/encounter-leak-tyrant.yaml'), 'utf-8')) as any;
  const e = (enc.enemies ?? [])[0];
  if (enc.id !== 'encounter-leak-tyrant' || !e) {
    return { name: 'Leak Tyrant encounter', passed: false, message: `Bad encounter id or no enemies: ${enc.id}` };
  }
  if (!e.enemy_id || !e.hp || !e.damage_formula?.dice_min || !e.damage_formula?.dice_max) {
    return { name: 'Leak Tyrant encounter', passed: false, message: `Enemy missing combat fields: ${JSON.stringify(e)}` };
  }
  if (!(e.leak_bytes > 0) || !(e.grow_hp_per_turn > 0)) {
    return { name: 'Leak Tyrant encounter', passed: false, message: 'Tyrant must declare leak_bytes > 0 and grow_hp_per_turn > 0' };
  }
  if (!enc.xp_reward) {
    return { name: 'Leak Tyrant encounter', passed: false, message: 'Encounter missing xp_reward' };
  }
  return {
    name: 'Leak Tyrant encounter',
    passed: true,
    message: `leak-tyrant declares ${e.leak_bytes} leaked bytes and +${e.grow_hp_per_turn} hp/turn growth as content`
  };
}

async function main() {
  console.log('=== Phase 4 Acceptance Script (Zones 8-9) ===\n');
  const results: CheckResult[] = [];

  results.push(await checkReferenceSolutions());
  results.push(await checkLeakLedger());
  results.push(await checkLeakMonsterGrowth());
  results.push(await checkByRefEnforced());
  results.push(await checkSmartPointerVariant());
  results.push(checkTyrantEncounter());

  console.log('\n=== Results ===');
  const passed = results.filter(r => r.passed).length;
  for (const r of results) {
    console.log(`${r.passed ? '✓ PASS' : '✗ FAIL'}: ${r.name}`);
    console.log(`       ${r.message}`);
  }
  console.log(`\nTotal: ${passed}/${results.length} checks passed`);
  if (passed === results.length) {
    console.log('\n✓ Phase 4 acceptance: ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log('\n✗ Phase 4 acceptance: SOME CHECKS FAILED');
    process.exit(1);
  }
}

main();
