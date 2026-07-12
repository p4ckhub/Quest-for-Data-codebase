import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { Spell, generateSpellbook } from './spellbook';

// §11.5: the TS side never simulates combat. This module only prepares the
// sandbox (state.json + regenerated spellbook), compiles the C++ combat
// harness, runs it under sandbox_run (guardrail #2 — spellbook source is
// player code), and parses the resulting event stream.

// The binary is sandbox_run on POSIX, sandbox_run.exe on Windows.
function sandboxRunExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'toolchain', 'bin', 'sandbox_run')) ||
         fs.existsSync(path.join(dir, 'toolchain', 'bin', 'sandbox_run.exe'));
}

function findProjectRoot(): string {
  let dir = __dirname;
  while (!sandboxRunExists(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Project root with toolchain/bin/sandbox_run not found above ${__dirname}`);
    }
    dir = parent;
  }
  return dir;
}

const PROJECT_ROOT = findProjectRoot();
const GAMEAPI_DIR = path.join(PROJECT_ROOT, 'gameapi');
const TOOLCHAIN_DIR = path.join(PROJECT_ROOT, 'toolchain');
const SANDBOX_RUN = fs.existsSync(path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run'))
  ? path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run')
  : path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run.exe');

function getCompilerProfile(): { path: string; extraFlags: string[] } {
  const lockPath = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
  if (fs.existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      const profileKey = process.platform === 'win32' ? 'windows-native' : 'linux-native';
      const profile = lockData.profiles?.[profileKey];
      if (profile?.path) {
        // Fetched profiles use repo-relative paths; fall back to PATH lookup
        // when the toolchain hasn't been downloaded yet (npm run toolchain:fetch).
        const resolved = path.isAbsolute(profile.path)
          ? profile.path
          : path.join(PROJECT_ROOT, profile.path);
        const compilerPath = !fs.existsSync(resolved) && profile.fetch
          ? (profile.compiler ?? 'g++')
          : resolved;
        return { path: compilerPath, extraFlags: profile.extra_flags ?? [] };
      }
    } catch { /* ignore */ }
  }
  return { path: process.platform === 'win32' ? 'g++' : '/usr/bin/g++', extraFlags: [] };
}

// Canonical CombatState (§11.5), extended with the data-driven fields the
// harness needs (damage_formula from classes.json, attack ranges from content).
export interface CombatState {
  v: 1;
  turn: number;
  player: PlayerState;
  enemies: EnemyState[];
  winner: string | null;
}

export interface PlayerState {
  class: string;
  hp: number;
  mp: number;
  max_hp: number;
  max_mp: number;
  str: number;
  agi: number;
  int: number;
  statuses: string[];
  damage_formula: {
    dice_min: number;
    dice_max: number;
    scaling_stat: string;
    scaling_div: number;
    mp_cost: number;
  };
}

export interface EnemyState {
  id: string;
  type: string;
  hp: number;
  max_hp: number;
  statuses: string[];
  attack?: { min: number; max: number };
  // §11.6 leak-monster seam: populated by the runner from alloc_report events
  leak_bytes?: number;
  grow_hp_per_turn?: number;
}

export interface CombatEvent {
  v?: number;
  type: string;
  [key: string]: any;
}

export interface CombatTurnResult {
  events: CombatEvent[];
  state: CombatState;
}

// Build a fresh CombatState from classes.json data + encounter enemy specs.
export function createCombatState(playerClass: string, enemies: EnemyState[], playerOverrides?: Partial<PlayerState>): CombatState {
  const classesPath = path.join(PROJECT_ROOT, 'content', 'classes.json');
  const classes = JSON.parse(fs.readFileSync(classesPath, 'utf-8')).classes;
  const cls = classes[playerClass];
  if (!cls) throw new Error(`Unknown class: ${playerClass}`);

  return {
    v: 1,
    turn: 1,
    player: {
      class: playerClass,
      hp: cls.base_stats.hp,
      mp: cls.base_stats.mp,
      max_hp: cls.base_stats.hp,
      max_mp: cls.base_stats.mp,
      str: cls.base_stats.str,
      agi: cls.base_stats.agi,
      int: cls.base_stats.int,
      statuses: [],
      damage_formula: cls.damage_formula,
      ...playerOverrides,
    },
    enemies,
    winner: null,
  };
}

export function writeCombatState(sandboxDir: string, state: CombatState): void {
  fs.writeFileSync(path.join(sandboxDir, 'state.json'), JSON.stringify(state, null, 2));
}

export function readCombatState(sandboxDir: string): CombatState {
  return JSON.parse(fs.readFileSync(path.join(sandboxDir, 'state.json'), 'utf-8'));
}

/**
 * Run one combat turn: regenerate the spellbook from the given spells,
 * compile the harness, execute it in the sandbox with cwd = sandboxDir
 * (where state.json lives), and return events + updated state.
 *
 * `extraSources` lets Bestiary-style callers link player-authored monster
 * translation units into the same harness (§11.5 Phase 3).
 */
export function runCombatTurn(
  sandboxDir: string,
  action: string,
  spells: Spell[],
  extraSources: string[] = []
): CombatTurnResult {
  const statePath = path.join(sandboxDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error('state.json not found in sandbox directory');
  }

  // Regenerate spellbook.h from the save's spells (§11.8: build artifact)
  const spellbookDir = path.join(sandboxDir, 'spellbook');
  fs.mkdirSync(spellbookDir, { recursive: true });
  generateSpellbook({ spellbook: spells }, spellbookDir);

  // Compile the harness against this spellbook. Argument-array invocation (no
  // shell): identical argv on both platforms, immune to spaces in paths.
  const exePath = path.join(sandboxDir, 'combat.exe');
  const compilerProfile = getCompilerProfile();
  const compileArgs = [
    '-std=c++17', '-O0', '-g0', '-Wall',
    ...compilerProfile.extraFlags,
    `-I${spellbookDir}`,
    `-I${GAMEAPI_DIR}`,
    `-I${path.join(GAMEAPI_DIR, 'third_party')}`,
    path.join(GAMEAPI_DIR, 'combat_main.cpp'),
    path.join(GAMEAPI_DIR, 'gameapi.cpp'),
    ...extraSources,
    '-o', exePath,
  ];

  try {
    execFileSync(compilerProfile.path, compileArgs, { stdio: 'pipe' });
  } catch (e: any) {
    const stderr = e.stderr ? String(e.stderr) : String(e.message);
    throw new Error(`Failed to compile combat harness: ${stderr}`);
  }

  // Execute under sandbox_run; cwd = sandboxDir so the harness finds state.json
  const runArgs = [
    '--wall-ms', '5000', '--cpu-ms', '3000', '--mem-mb', '512', '--stdout-cap-kb', '1024',
    '--cwd', sandboxDir,
    '--', exePath, '--action', action,
  ];
  let output: string;
  try {
    output = execFileSync(SANDBOX_RUN, runArgs, { encoding: 'utf-8', stdio: 'pipe', cwd: sandboxDir });
  } catch (e: any) {
    output = (e.stdout ? String(e.stdout) : '') + (e.stderr ? String(e.stderr) : '');
  }

  const events = parseCombatEvents(output);
  const state = readCombatState(sandboxDir);
  return { events, state };
}

export function parseCombatEvents(output: string): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('@@EV@@ ')) {
      try {
        events.push(JSON.parse(line.substring('@@EV@@ '.length).trim()));
      } catch { /* skip malformed events */ }
    }
  }
  return events;
}
