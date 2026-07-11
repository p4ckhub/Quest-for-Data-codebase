// Phase 3 acceptance: OOP (Zones 6-7) is real and polymorphic.
// Core proof (spec §Phase 3 acceptance): two DIFFERENT reference Monster
// subclasses fight correctly with BYTE-IDENTICAL harness code — the harness
// never names a concrete subclass; virtual dispatch does the work. Plus:
// every Zone 6/7 lesson passes with its reference solution, a wrong subclass
// fails the right check, the on_hit virtual hook demonstrably fires, and
// Spellbook regeneration (§11.8) round-trips from a save.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { runLesson, Lesson } from '../runner/src/index';
import { createCombatState, writeCombatState, runCombatTurn, EnemyState } from '../runner/src/combat';
import { generateSpellbook, Spell } from '../runner/src/spellbook';

const BASE_DIR = path.join(__dirname, '..');
const ZONE_DIRS = ['guild_of_artificers', 'the_bestiary'];

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

function loadLesson(rel: string): Lesson {
  return yaml.load(fs.readFileSync(path.join(BASE_DIR, rel), 'utf-8')) as Lesson;
}

// Check 1: every Zone 6/7 lesson passes with its reference solution
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
    name: 'Reference solutions (Zones 6-7)',
    passed: failures.length === 0,
    message: failures.length ? failures.join('; ') : `All ${count} lessons pass with reference solutions`
  };
}

// Check 2: THE Phase 3 proof — two different player-written Monster
// subclasses fight in the REAL combat harness (combat_main.cpp) with zero
// harness changes. Each subclass's deterministic attack value must come back
// as the enemy-turn damage, proving the harness reached the player's override
// through virtual dispatch rather than any data-driven fallback.
async function checkTwoSubclassesOneHarness(): Promise<CheckResult> {
  const harnessPath = path.join(BASE_DIR, 'gameapi', 'combat_main.cpp');
  const harnessHashBefore = crypto.createHash('sha256').update(fs.readFileSync(harnessPath)).digest('hex');

  const wolf = loadLesson('content/zones/act1/the_bestiary/zone-7-lesson-1.yaml') as any;
  const bat = loadLesson('content/zones/act1/the_bestiary/zone-7-lesson-2.yaml') as any;

  const spells: Spell[] = [{
    lesson_id: 'forge-strike-warrior',
    name: 'strike',
    signature: 'int strike()',
    source: 'int strike() {\n    return 6;\n}',
  }];

  const fights: Array<{ lesson: any; type: string; expectedDamage: number }> = [
    { lesson: wolf, type: 'ash_wolf', expectedDamage: 7 },
    { lesson: bat, type: 'cinder_bat', expectedDamage: 4 },
  ];

  const observed: string[] = [];
  for (const fight of fights) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept3-combat-'));
    try {
      const enemy: EnemyState = {
        id: `${fight.type}-1`, type: fight.type, hp: 60, max_hp: 60, statuses: [],
      };
      writeCombatState(dir, createCombatState('warrior', [enemy]));

      // The player's monster translation unit: lesson prelude (includes) +
      // reference solution + lesson epilogue (REGISTER_MONSTER), exactly as
      // the lesson pipeline assembles player code.
      const tu = path.join(dir, 'player_monster.cpp');
      fs.writeFileSync(tu, `${fight.lesson.prelude}\n${fight.lesson.solution}\n${fight.lesson.epilogue}\n`);

      const result = runCombatTurn(dir, 'strike', spells, [tu]);
      const hit = result.events.find((e) => e.type === 'damage' && e.target === 'player');
      if (!hit) {
        return {
          name: 'Two subclasses, one harness',
          passed: false,
          message: `${fight.type}: no enemy damage event (events: ${JSON.stringify(result.events.map(e => e.type))})`
        };
      }
      if (hit.amount !== fight.expectedDamage) {
        return {
          name: 'Two subclasses, one harness',
          passed: false,
          message: `${fight.type}: enemy hit for ${hit.amount}, expected the subclass's attack() value ${fight.expectedDamage} — virtual dispatch did not reach the player's override`
        };
      }
      observed.push(`${fight.type} attacked for ${hit.amount}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const harnessHashAfter = crypto.createHash('sha256').update(fs.readFileSync(harnessPath)).digest('hex');
  if (harnessHashBefore !== harnessHashAfter) {
    return { name: 'Two subclasses, one harness', passed: false, message: 'combat_main.cpp changed between fights' };
  }
  return {
    name: 'Two subclasses, one harness',
    passed: true,
    message: `${observed.join('; ')} — byte-identical combat_main.cpp (sha256 ${harnessHashBefore.slice(0, 12)}…) for both`
  };
}

// Check 3: the bestiary lesson harness is one shared file across all Zone 7
// lessons (no per-class special-casing), and it exists.
function checkSharedBestiaryHarness(): CheckResult {
  const zonePath = path.join(BASE_DIR, 'content/zones/act1/the_bestiary');
  const harnesses = new Set<string>();
  for (const file of fs.readdirSync(zonePath).sort()) {
    if (file.startsWith('encounter-')) continue;
    const lesson = loadLesson(`content/zones/act1/the_bestiary/${file}`) as any;
    harnesses.add(lesson.harness ?? '(none)');
  }
  if (harnesses.size !== 1 || harnesses.has('(none)')) {
    return {
      name: 'Shared bestiary harness',
      passed: false,
      message: `Expected one shared harness for all Bestiary lessons, got: ${[...harnesses].join(', ')}`
    };
  }
  const harnessFile = [...harnesses][0];
  if (!fs.existsSync(path.join(BASE_DIR, 'gameapi', harnessFile))) {
    return { name: 'Shared bestiary harness', passed: false, message: `Harness file missing: ${harnessFile}` };
  }
  return {
    name: 'Shared bestiary harness',
    passed: true,
    message: `All Bestiary lessons run through the single harness ${harnessFile}`
  };
}

// Check 4: a wrong subclass actually fails with the right check id
async function checkWrongSubclassFails(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/the_bestiary/zone-7-lesson-1.yaml');
  const wrong = [
    'class AshWolf : public Monster {',
    'public:',
    '    std::string species() const override { return "ash wolf"; }',
    '    int attack() override { return 7; }',
    '    int max_hp() const override { return 26; }',
    '};',
  ].join('\n');
  const r = await runLesson(lesson, wrong);
  if (r.passed === true || !(r.failedCheckIds ?? []).includes('species')) {
    return {
      name: 'Wrong subclass rejected',
      passed: false,
      message: `Lowercase species should fail check species: passed=${r.passed} failed=${r.failedCheckIds}`
    };
  }
  return {
    name: 'Wrong subclass rejected',
    passed: true,
    message: 'Miswritten species() fails with failedCheckIds=[species]'
  };
}

// Check 5: the on_hit virtual hook demonstrably changes behavior (Grave Troll
// rages: pre-hit attacks 6, post-hit attack 11 — computed by the player code)
async function checkVirtualHook(): Promise<CheckResult> {
  const lesson = loadLesson('content/zones/act1/the_bestiary/zone-7-lesson-3.yaml') as any;
  const r = await runLesson(lesson, lesson.solution);
  const ev = (r.events ?? []).filter((e: any) => e.type === 'check');
  const value = (id: string) => ev.find((e: any) => e.id === id)?.value;
  if (r.passed !== true || value('attack_max') !== 6 || value('post_hit_attack') !== 11) {
    return {
      name: 'Virtual on_hit hook',
      passed: false,
      message: `Expected calm attacks 6 and enraged attack 11: passed=${r.passed} attack_max=${value('attack_max')} post_hit=${value('post_hit_attack')}`
    };
  }
  return {
    name: 'Virtual on_hit hook',
    passed: true,
    message: 'on_hit(10) raised the troll\'s attack from 6 to 11 through the base-class hook'
  };
}

// Check 6: Spellbook regeneration (§11.8) round-trips from a save — the same
// save produces the same spellbook.h twice, namespaced per lesson id, and the
// compile gate passes.
function checkSpellbookRoundTrip(): CheckResult {
  const spells: Spell[] = [
    { lesson_id: 'forge-strike-warrior', name: 'strike', signature: 'int strike()', source: 'int strike() {\n    return 6;\n}' },
    { lesson_id: 'forging-the-flurry', name: 'flurry', signature: 'int flurry()', source: 'int flurry() {\n    int total = 0;\n    for (int i = 0; i < 3; ++i) total += 4;\n    return total;\n}' },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept3-spellbook-'));
  try {
    generateSpellbook({ spellbook: spells }, dir);
    const first = fs.readFileSync(path.join(dir, 'spellbook.h'), 'utf-8');
    generateSpellbook({ spellbook: spells }, dir);
    const second = fs.readFileSync(path.join(dir, 'spellbook.h'), 'utf-8');
    if (first !== second) {
      return { name: 'Spellbook round-trip', passed: false, message: 'Regenerating from the same save produced different spellbook.h contents' };
    }
    for (const ns of ['sb_forge_strike_warrior', 'sb_forging_the_flurry']) {
      if (!first.includes(`namespace ${ns} {`)) {
        return { name: 'Spellbook round-trip', passed: false, message: `spellbook.h missing namespace ${ns}` };
      }
    }
    return {
      name: 'Spellbook round-trip',
      passed: true,
      message: 'Same save → same spellbook.h twice, per-lesson namespaces present, compile gate passed'
    };
  } catch (e: any) {
    return { name: 'Spellbook round-trip', passed: false, message: `generateSpellbook threw: ${e.message}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Check 7: the Zone 7 boss encounter is combat-ready content
function checkAlphaEncounter(): CheckResult {
  const encPath = 'content/zones/act1/the_bestiary/encounter-bestiary-alpha.yaml';
  const enc = yaml.load(fs.readFileSync(path.join(BASE_DIR, encPath), 'utf-8')) as any;
  const enemies = enc.enemies ?? [];
  if (enc.id !== 'encounter-bestiary-alpha' || enemies.length < 1) {
    return { name: 'Bestiary Alpha encounter', passed: false, message: `Bad encounter id or no enemies: ${enc.id}` };
  }
  for (const e of enemies) {
    if (!e.enemy_id || !e.hp || !e.damage_formula?.dice_min || !e.damage_formula?.dice_max) {
      return { name: 'Bestiary Alpha encounter', passed: false, message: `Enemy missing combat fields: ${JSON.stringify(e)}` };
    }
  }
  if (!enc.xp_reward) {
    return { name: 'Bestiary Alpha encounter', passed: false, message: 'Encounter missing xp_reward' };
  }
  return {
    name: 'Bestiary Alpha encounter',
    passed: true,
    message: `bestiary-alpha declares ${enemies.length} combat-ready enem${enemies.length === 1 ? 'y' : 'ies'} with rewards`
  };
}

async function main() {
  console.log('=== Phase 3 Acceptance Script (Zones 6-7) ===\n');
  const results: CheckResult[] = [];

  results.push(await checkReferenceSolutions());
  results.push(await checkTwoSubclassesOneHarness());
  results.push(checkSharedBestiaryHarness());
  results.push(await checkWrongSubclassFails());
  results.push(await checkVirtualHook());
  results.push(checkSpellbookRoundTrip());
  results.push(checkAlphaEncounter());

  console.log('\n=== Results ===');
  const passed = results.filter(r => r.passed).length;
  for (const r of results) {
    console.log(`${r.passed ? '✓ PASS' : '✗ FAIL'}: ${r.name}`);
    console.log(`       ${r.message}`);
  }
  console.log(`\nTotal: ${passed}/${results.length} checks passed`);
  if (passed === results.length) {
    console.log('\n✓ Phase 3 acceptance: ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log('\n✗ Phase 3 acceptance: SOME CHECKS FAILED');
    process.exit(1);
  }
}

main();
