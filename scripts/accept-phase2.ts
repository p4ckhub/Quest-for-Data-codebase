// Phase 2 acceptance: Zones 3-5 content is real and computed.
// Core proof (spec §Phase 2 acceptance): two DIFFERENT player solutions to the
// same lesson produce two DIFFERENT computed branches — the game reacts to
// what the code actually did, not to a canned script. Plus: every lesson
// passes with its reference solution, the infinite-loop timeout row fires as
// content, the stdin lesson exercises --stdin-file, and the wave encounter
// declares multiple enemies.
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runLesson, Lesson } from '../runner/src/index';

const BASE_DIR = path.join(__dirname, '..');
const ZONE_DIRS = ['crossroads_of_choices', 'endless_corridor', 'archive_armory'];

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

function loadLesson(rel: string): Lesson {
  return yaml.load(fs.readFileSync(path.join(BASE_DIR, rel), 'utf-8')) as Lesson;
}

// Check 1: every Zone 3/4/5 lesson passes with its reference solution
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
    name: 'Reference solutions (Zones 3-5)',
    passed: failures.length === 0,
    message: failures.length ? failures.join('; ') : `All ${count} lessons pass with reference solutions`
  };
}

// Check 2: THE Phase 2 proof — two different solutions, two different branches.
// gate-of-doctrines: choose_gate returning 1 vs 2 must both pass but produce
// different in-game events (Valor log vs Cunning log), computed from the code.
async function checkTwoSolutionsTwoBranches(): Promise<CheckResult> {
  const gate = loadLesson('content/zones/act1/crossroads_of_choices/zone-3-lesson-3.yaml');

  const valor = await runLesson(gate, 'int choose_gate(int omen) {\n    return 1;\n}');
  const cunning = await runLesson(gate, 'int choose_gate(int omen) {\n    return 2;\n}');

  if (valor.passed !== true || cunning.passed !== true) {
    return {
      name: 'Two solutions, two branches',
      passed: false,
      message: `Both doctrines must pass: valor=${valor.passed} cunning=${cunning.passed}`
    };
  }

  const logOf = (r: any) =>
    (r.events ?? []).filter((e: any) => e.type === 'log').map((e: any) => e.msg ?? e.message).join('|');
  const valorLog = logOf(valor);
  const cunningLog = logOf(cunning);

  if (!valorLog || valorLog === cunningLog) {
    return {
      name: 'Two solutions, two branches',
      passed: false,
      message: `Branches did not diverge: valor="${valorLog}" cunning="${cunningLog}"`
    };
  }
  if (!valorLog.includes('Valor') || !cunningLog.includes('Cunning')) {
    return {
      name: 'Two solutions, two branches',
      passed: false,
      message: `Wrong branch content: valor="${valorLog}" cunning="${cunningLog}"`
    };
  }
  return {
    name: 'Two solutions, two branches',
    passed: true,
    message: 'gate=1 and gate=2 both pass and emit different computed game events'
  };
}

// Check 3: wrong values actually fail (the checks are not decorative)
async function checkWrongValuesFail(): Promise<CheckResult> {
  const gate = loadLesson('content/zones/act1/crossroads_of_choices/zone-3-lesson-3.yaml');
  const bad = await runLesson(gate, 'int choose_gate(int omen) {\n    return 9;\n}');
  if (bad.passed === true || !(bad.failedCheckIds ?? []).includes('gate_choice')) {
    return {
      name: 'Wrong values rejected',
      passed: false,
      message: `gate=9 should fail check gate_choice: passed=${bad.passed} failed=${bad.failedCheckIds}`
    };
  }
  return {
    name: 'Wrong values rejected',
    passed: true,
    message: 'Out-of-range gate fails with failedCheckIds=[gate_choice]'
  };
}

// Check 4: timeout-as-content — an infinite loop in the while lesson must be
// killed by the sandbox and surface as check_failed:exit_status, and the
// lesson must carry a hint on that trigger (the Corridor "devours the echo").
async function checkTimeoutRow(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/endless_corridor/zone-4-lesson-1.yaml');
  const hint = ((lesson as any).hints ?? []).find((h: any) => h.trigger === 'check_failed:exit_status');
  if (!hint) {
    return {
      name: 'Timeout row as content',
      passed: false,
      message: 'zone-4-lesson-1 has no check_failed:exit_status hint'
    };
  }
  const r = await runLesson(lesson, '      while (wards > 0) {\n          strikes += 0;\n      }\n');
  if (r.passed === true || !(r.failedCheckIds ?? []).includes('exit_status')) {
    return {
      name: 'Timeout row as content',
      passed: false,
      message: `Infinite loop should fail exit_status: passed=${r.passed} failed=${r.failedCheckIds} error=${r.error}`
    };
  }
  return {
    name: 'Timeout row as content',
    passed: true,
    message: 'Infinite loop is killed and fires check_failed:exit_status (hint present)'
  };
}

// Check 5: stdin lesson really reads from --stdin-file, and a wrong read fails
async function checkStdinLesson(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/archive_armory/zone-5-lesson-4.yaml');
  if (!(lesson as any).stdin_fixture) {
    return { name: 'stdin fixture lesson', passed: false, message: 'zone-5-lesson-4 missing stdin_fixture' };
  }
  const good = await runLesson(lesson, (lesson as any).solution);
  const bad = await runLesson(lesson, '      std::cin >> item;\n'); // never reads count
  if (good.passed !== true) {
    return { name: 'stdin fixture lesson', passed: false, message: `Reference solution failed: ${good.error}` };
  }
  if (bad.passed === true || !(bad.failedCheckIds ?? []).includes('count')) {
    return {
      name: 'stdin fixture lesson',
      passed: false,
      message: `Skipping the count read should fail check count: passed=${bad.passed} failed=${bad.failedCheckIds}`
    };
  }
  return {
    name: 'stdin fixture lesson',
    passed: true,
    message: 'cin lesson reads the fixture; skipping a read fails the count check'
  };
}

// Check 6: wave encounter declares multiple enemies with combat-ready fields
function checkWaveEncounter(): CheckResult {
  const encPath = 'content/zones/act1/endless_corridor/encounter-corridor-swarm.yaml';
  const enc = yaml.load(fs.readFileSync(path.join(BASE_DIR, encPath), 'utf-8')) as any;
  const enemies = enc.enemies ?? [];
  if (enemies.length < 2) {
    return { name: 'Wave encounter', passed: false, message: `Expected multiple enemies, got ${enemies.length}` };
  }
  for (const e of enemies) {
    if (!e.enemy_id || !e.hp || !e.damage_formula?.dice_min || !e.damage_formula?.dice_max) {
      return { name: 'Wave encounter', passed: false, message: `Enemy missing combat fields: ${JSON.stringify(e)}` };
    }
  }
  if (!enc.xp_reward) {
    return { name: 'Wave encounter', passed: false, message: 'Encounter missing xp_reward' };
  }
  return {
    name: 'Wave encounter',
    passed: true,
    message: `corridor-swarm declares ${enemies.length} combat-ready enemies`
  };
}

// Check 7: the loop-forged spell lesson grants a spell (feeds the boss fight)
function checkFlurrySpellGrant(): CheckResult {
  const lesson = loadLesson('content/zones/act1/endless_corridor/zone-4-lesson-4.yaml') as any;
  const g = lesson.grants_spell;
  if (!g?.name || !g?.signature) {
    return { name: 'Loop spell grant', passed: false, message: 'zone-4-lesson-4 missing grants_spell {name, signature}' };
  }
  const harness = path.join(BASE_DIR, 'gameapi', lesson.harness ?? '');
  if (!lesson.harness || !fs.existsSync(harness)) {
    return { name: 'Loop spell grant', passed: false, message: `Harness missing: ${lesson.harness}` };
  }
  return {
    name: 'Loop spell grant',
    passed: true,
    message: `forging-the-flurry grants ${g.signature} via ${lesson.harness}`
  };
}

async function main() {
  console.log('=== Phase 2 Acceptance Script (Zones 3-5) ===\n');
  const results: CheckResult[] = [];

  results.push(await checkReferenceSolutions());
  results.push(await checkTwoSolutionsTwoBranches());
  results.push(await checkWrongValuesFail());
  results.push(await checkTimeoutRow());
  results.push(await checkStdinLesson());
  results.push(checkWaveEncounter());
  results.push(checkFlurrySpellGrant());

  console.log('\n=== Results ===');
  const passed = results.filter(r => r.passed).length;
  for (const r of results) {
    console.log(`${r.passed ? '✓ PASS' : '✗ FAIL'}: ${r.name}`);
    console.log(`       ${r.message}`);
  }
  console.log(`\nTotal: ${passed}/${results.length} checks passed`);
  if (passed === results.length) {
    console.log('\n✓ Phase 2 acceptance: ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log('\n✗ Phase 2 acceptance: SOME CHECKS FAILED');
    process.exit(1);
  }
}

main();
