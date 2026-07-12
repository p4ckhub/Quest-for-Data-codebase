import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import * as yaml from 'js-yaml';
import { evaluateChecks, CheckSpec, CheckResult as ValidatorCheckResult } from './validator';
import { classifyFirstError } from './error_table';

// The binary is sandbox_run on POSIX, sandbox_run.exe on Windows.
function sandboxRunExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'toolchain', 'bin', 'sandbox_run')) ||
         fs.existsSync(path.join(dir, 'toolchain', 'bin', 'sandbox_run.exe'));
}

// This module runs from two locations with different depths: runner/src (ts-node,
// vitest) and dist/runner/src (compiled, loaded by the Electron main process).
// Walk up to the project root instead of hardcoding a relative depth; the marker
// is toolchain/bin/sandbox_run[.exe] (dist/ also carries a stray toolchain.lock.json,
// so the lock file alone is not a safe marker).
export function findProjectRoot(): string {
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

const TOOLCHAIN_DIR = path.join(findProjectRoot(), 'toolchain');

// Resolve the actual on-disk sandbox binary name. execFileSync with an explicit
// path does no PATHEXT resolution, so the .exe must be spelled out on Windows.
function resolveSandboxRun(): string {
  const base = path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run');
  if (fs.existsSync(base)) return base;
  return base + '.exe';
}

// Read compiler path (+ optional extra flags) from the platform's toolchain
// lock profile. extra_flags carries e.g. -static on Windows so player-compiled
// lesson.exe doesn't need MinGW DLLs on the player's machine. A fetched
// profile's path is repo-relative (toolchain/mingw64/...); if the toolchain
// hasn't been downloaded yet (npm run toolchain:fetch), fall back to PATH.
function getCompilerProfile(): { path: string; extraFlags: string[] } {
  const lockPath = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  const profileKey = process.platform === 'win32' ? 'windows-native' : 'linux-native';
  const profile = lockData.profiles?.[profileKey];
  if (profile?.path) {
    const resolved = path.isAbsolute(profile.path)
      ? profile.path
      : path.join(path.dirname(TOOLCHAIN_DIR), profile.path);
    const compilerPath = !fs.existsSync(resolved) && profile.fetch
      ? (profile.compiler ?? 'g++')
      : resolved;
    return { path: compilerPath, extraFlags: profile.extra_flags ?? [] };
  }
  return { path: process.platform === 'win32' ? 'g++' : '/usr/bin/g++', extraFlags: [] };
}

const PCH_PATH = path.join(TOOLCHAIN_DIR, 'pch', 'linux-native', 'gameapi.pch');
const USE_PCH = false; // PCH not compatible with g++, disabled
const COMPILER_PROFILE = getCompilerProfile();
const COMPILER_PATH = COMPILER_PROFILE.path;

export interface Lesson {
  id: string;
  kind: 'program' | 'functions';
  objective: string;
  starter_code: string;
  prelude?: string;
  epilogue?: string;
  harness?: string;
  extra_units?: string[];   // hidden units linked from gameapi/ (§11.6)
  compile_mode?: 'double_include'; // P2-6: player text is a header, pasted twice into one unit (header-guard lessons)
  validation?: Validation;
  hints?: Hint[];
  teaching?: string;        // always-visible instruction block, worked example inside (PHASE1.5 §3)
  examples?: Array<{ prompt: string; code: string }>; // fixed practice variations (PHASE1.5 §3)
  narrative?: string;
  solution?: string;
  stdin_fixture?: string;
  limits?: Partial<Limits>;
  grants_spell?: { name: string; signature: string };
  rewards?: { xp: number; items?: Array<{ item_id: string; count: number }>; unlocks_zone_progress?: boolean };
  encounter?: string; // encounter id this lesson triggers on pass (boss fights)
}

export interface Limits {
  compile_ms: number;
  wall_ms: number;
  cpu_ms: number;
  mem_mb: number;
  stdout_cap_kb: number;
}

// §10.3 defaults; lesson `limits:` may override each up to 10×
const DEFAULT_LIMITS: Limits = {
  compile_ms: 10000,
  wall_ms: 3000,
  cpu_ms: 2000,
  mem_mb: 512,
  stdout_cap_kb: 1024,
};

function resolveLimits(overrides?: Partial<Limits>): Limits {
  const out = { ...DEFAULT_LIMITS };
  if (overrides) {
    for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof Limits>) {
      const v = overrides[key];
      if (typeof v === 'number') {
        // Guardrail #1: never beyond 10× the §10.3 default
        out[key] = Math.min(v, DEFAULT_LIMITS[key] * 10);
      }
    }
  }
  return out;
}

export interface Validation {
  checks: Check[];
}

export interface Check {
  type: string;
  [key: string]: any;
}

export interface Hint {
  trigger: string;
  message: string;
}

export interface RunResult {
  success: boolean;          // compiled and ran (clean per §10.5)
  passed?: boolean;          // §11.4 verdict: all validation.checks passed
  checks?: ValidatorCheckResult[];
  failedCheckIds?: string[]; // drives `check_failed:<id>` hint triggers
  events?: any[];            // parsed @@EV@@ events for the UI to render
  output: string;
  rawStdout?: string;        // player-visible non-event stdout
  error?: string;
  errorId?: string;          // canonical FET error id (drives `error:<id>` hint triggers)
  compileError?: string;
}

export async function runLesson(lesson: Lesson, playerCode: string): Promise<RunResult> {
  try {
    // 1. Assemble main.cpp
    const tempDir = path.join(os.tmpdir(), `quest-${lesson.id}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    let fullCode: string;
    if (lesson.compile_mode === 'double_include') {
      // The player's editor text is a book (header), not a program. It is
      // written to tome.h and included TWICE into one unit; the lesson's
      // prelude/epilogue supply the surrounding scroll. An unguarded tome
      // holding a definition fails with a redefinition refusal.
      fs.writeFileSync(path.join(tempDir, 'tome.h'), playerCode);
      fullCode = `${lesson.prelude || ''}\n#include "tome.h"\n#include "tome.h"\n${lesson.epilogue || ''}`;
    } else {
      fullCode = `${lesson.prelude || ''}\n${playerCode}\n${lesson.epilogue || ''}`;
    }

    const mainCpp = path.join(tempDir, 'main.cpp');
    fs.writeFileSync(mainCpp, fullCode);

    const limits = resolveLimits(lesson.limits);

    // 2. Compile with the platform's native toolchain profile
    const exePath = path.join(tempDir, 'lesson.exe');
    const pchFlagParts = USE_PCH ? ['-include-pch', PCH_PATH] : [];
    const gameapiDir = path.join(TOOLCHAIN_DIR, '..', 'gameapi');
    const gameapiCpp = path.join(gameapiDir, 'gameapi.cpp');
    const jsonInclude = path.join(gameapiDir, 'third_party');

    let extraSources = [mainCpp, gameapiCpp];

    // For kind=functions, include the harness file (player functions + harness main)
    if (lesson.kind === 'functions' && lesson.harness) {
      const harnessPath = path.join(gameapiDir, lesson.harness);
      extraSources = [mainCpp, harnessPath, gameapiCpp];
    }

    // Extra hidden units the lesson links in (§11.6: leakcheck.cpp for
    // memory-zone lessons). Always from gameapi/, never player-supplied paths.
    for (const unit of lesson.extra_units ?? []) {
      extraSources.push(path.join(gameapiDir, path.basename(unit)));
    }

    // Argument-array invocation (no shell): identical argv on both platforms,
    // immune to spaces in paths (C:\Program Files\..., usernames with spaces).
    const compileArgs = [
      '-std=c++17', '-O0', '-g0', '-Wall',
      ...COMPILER_PROFILE.extraFlags,
      ...pchFlagParts,
      `-I${gameapiDir}`,
      `-I${jsonInclude}`,
      ...extraSources,
      '-o', exePath,
    ];

    let compileOutput: string;
    let compileSuccessful = true;

    try {
      compileOutput = execFileSync(COMPILER_PATH, compileArgs, { encoding: 'utf8', stdio: 'pipe', timeout: limits.compile_ms });
    } catch (e: any) {
      compileSuccessful = false;
      compileOutput = e.stdout ? String(e.stdout) : '';
      const stderr = e.stderr ? String(e.stderr) : '';
      if (stderr) compileOutput += '\n' + stderr;
    }

    if (!compileSuccessful) {
      const classified = classifyFirstError(compileOutput);
      return {
        success: false,
        passed: false,
        output: '',
        compileError: compileOutput,
        errorId: classified.id
      };
    }

    // 2b. stdin fixture (§11.3): required for any lesson using std::cin
    let stdinArgs: string[] = [];
    if (lesson.stdin_fixture !== undefined) {
      const stdinPath = path.join(tempDir, 'input.txt');
      fs.writeFileSync(stdinPath, lesson.stdin_fixture);
      stdinArgs = ['--stdin-file', stdinPath];
    }

    // 3. Execute under sandbox_run with lesson-resolved limits
    const sandboxArgs = [
      '--wall-ms', String(limits.wall_ms),
      '--cpu-ms', String(limits.cpu_ms),
      '--mem-mb', String(limits.mem_mb),
      '--stdout-cap-kb', String(limits.stdout_cap_kb),
      ...stdinArgs,
      '--', exePath,
    ];

    let execOutput: string;
    let execStderr = '';
    try {
      execOutput = execFileSync(resolveSandboxRun(), sandboxArgs, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: any) {
      // sandbox_run returns 0 but may have killed the process
      execOutput = e.stdout ? String(e.stdout) : '';
      if (e.stderr) execStderr = String(e.stderr);
    }

    // 4. Parse @@EV@@ events, @@RESULT@@ line, and raw (player-visible) stdout
    const { events, result, rawStdout } = parseExecutionOutput(execOutput);

    // 5. Map outcome to game result
    const outcome = mapOutcome(result);

    // 6. §11.4: evaluate validation.checks — the single validation pipeline.
    //    Runs even on abnormal exits: some lessons REQUIRE a crash (exit_status rows).
    const checkSpecs = (lesson.validation?.checks ?? []) as CheckSpec[];
    const validation = evaluateChecks(checkSpecs, {
      events,
      result,
      rawStdout,
      rawStderr: execStderr,
      playerSource: playerCode,
    });

    return {
      success: outcome.success,
      passed: validation.passed,
      checks: validation.checks,
      failedCheckIds: validation.failedCheckIds,
      events,
      output: formatOutput(events, result, outcome),
      rawStdout,
      error: outcome.error
    };

  } catch (error: any) {
    return {
      success: false,
      passed: false,
      output: '',
      error: error.message,
      compileError: error.message
    };
  }
}

export interface ExecutionResult {
  exit_code: number;
  wall_ms: number;
  cpu_ms: number;
  killed_by: string | null;
}

export interface ParsedOutput {
  events: any[];
  result: ExecutionResult;
  rawStdout: string; // non-sentinel lines: the player's own cout output, shown verbatim (§11.1)
}

export function parseExecutionOutput(output: string): ParsedOutput {
  const events: any[] = [];
  const rawLines: string[] = [];
  let resultLine = '';

  const lines = output.split('\n');
  for (const line of lines) {
    if (line.startsWith('@@EV@@ ')) {
      const jsonStr = line.substring('@@EV@@ '.length).trim();
      try {
        events.push(JSON.parse(jsonStr));
      } catch (e: any) {
        // Malformed JSON after sentinel: show raw line in Output tab (§11.1)
        rawLines.push(line);
      }
    } else if (line.startsWith('@@RESULT@@ ')) {
      resultLine = line;
    } else {
      rawLines.push(line);
    }
  }
  
  let result: ExecutionResult = { exit_code: 0, wall_ms: 0, cpu_ms: 0, killed_by: null };
  
  if (resultLine) {
    const jsonStr = resultLine.substring('@@RESULT@@ '.length).trim();
    try {
      const parsed = JSON.parse(jsonStr);
      result = {
        exit_code: parsed.exit_code ?? 0,
        wall_ms: parsed.wall_ms ?? 0,
        cpu_ms: parsed.cpu_ms ?? 0,
        killed_by: parsed.killed_by ?? null
      };
    } catch (e: any) {
      // If parsing fails, keep default result
    }
  }

  return { events, result, rawStdout: rawLines.join('\n').trim() };
}

export interface Outcome {
  success: boolean;
  error?: string;
  messages: string[];
}

export function mapOutcome(result: ExecutionResult): Outcome {
  const messages: string[] = [];
  
  if (result.exit_code === 0 && result.killed_by === null) {
    // Clean exit - validation will happen separately
    return { success: true, messages };
  }
  
  let error: string | undefined;
  
  switch (result.killed_by) {
    case 'wall_timeout':
    case 'cpu_timeout':
      error = 'Your incantation rages beyond control — the Compiler severs it. (Is a loop failing to end?)';
      break;
    case 'memory':
      // Could be SIGSEGV, SIGKILL, or bad_alloc
      error = 'The spell devoured all the aether it was granted.';
      break;
    case 'output_cap':
      error = 'The incantation babbles endlessly; the Compiler silences it.';
      break;
    default:
      if (result.exit_code !== 0) {
        // Nonzero exit code
        error = `The incantation collapsed before completing (exit code ${result.exit_code}).`;
      }
      break;
  }
  
  return { success: false, error, messages };
}

export function formatOutput(events: any[], result: ExecutionResult, outcome: Outcome): string {
  const lines: string[] = [];
  
  // Add event output
  for (const ev of events) {
    if (ev.type === 'log' && ev.msg) {
      lines.push(ev.msg);
    }
    // Other event types are game-internal
  }
  
  // Add result info
  if (outcome.error) {
    lines.push(`[RUNTIME ERROR] ${outcome.error}`);
  } else if (!outcome.success) {
    lines.push('[RUNTIME ERROR] Program terminated abnormally.');
  }
  
  lines.push(`\n[RESULT] exit_code=${result.exit_code}, wall_ms=${result.wall_ms}, killed_by=${result.killed_by || 'null'}`);
  
  return lines.join('\n');
}

// Export types for YAML lesson parsing
export { yaml };

/**
 * Substitute template variables with class-specific values.
 * Supports {{class_name}}, {{starter_spell}}, and {{weapon}}.
 * starter_spell is replaced with the full signature (e.g. "int strike()")
 */
export function substituteVariables(lesson: Lesson, classData: any): Lesson {
  const result = { ...lesson };
  
  // Extract values from class data
  const class_name = classData.display_name;
  const weapon = classData.weapon;
  const starter_spell_sig = classData.starter_spell?.signature;
  
  // Helper to substitute variables in a string
  const substituteString = (text: string): string => {
    if (!text) return text;
    return text
      .replace(/\{\{class_name\}\}/g, class_name)
      .replace(/\{\{weapon\}\}/g, weapon)
      .replace(/\{\{starter_spell\}\}/g, starter_spell_sig || '');
  };
  
  // Apply substitution to all string fields
  result.objective = substituteString(result.objective);
  if (result.prelude) result.prelude = substituteString(result.prelude);
  if (result.epilogue) result.epilogue = substituteString(result.epilogue);
  result.starter_code = substituteString(result.starter_code);
  result.narrative = substituteString(result.narrative);
  result.solution = substituteString(result.solution);
  if (result.teaching) result.teaching = substituteString(result.teaching);
  if (result.examples && Array.isArray(result.examples)) {
    result.examples = result.examples.map(ex => ({
      prompt: substituteString(ex.prompt),
      code: substituteString(ex.code),
    }));
  }
  
  // Handle hints: substitute in message field
  if (result.hints && Array.isArray(result.hints)) {
    result.hints = result.hints.map(hint => ({
      ...hint,
      message: substituteString(hint.message)
    }));
  }

  // Validation checks: stdout/source checks may assert class-substituted
  // output (e.g. text: "As a {{class_name}}"), so substitute their string
  // fields too. Only string-typed fields — numeric expected values pass through.
  if (result.validation?.checks && Array.isArray(result.validation.checks)) {
    result.validation = {
      ...result.validation,
      checks: result.validation.checks.map((check: any) => ({
        ...check,
        ...(typeof check.text === 'string' ? { text: substituteString(check.text) } : {}),
        ...(typeof check.regex === 'string' ? { regex: substituteString(check.regex) } : {}),
        ...(typeof check.expected === 'string' ? { expected: substituteString(check.expected) } : {}),
      })),
    };
  }

  // grants_spell is field-sensitive: {{starter_spell}} means the spell's NAME
  // in `name` but the full C++ signature in `signature` (the save feeds the
  // signature straight into the spellbook dispatcher, so it must parse).
  const grants = (result as any).grants_spell;
  if (grants) {
    (result as any).grants_spell = {
      ...grants,
      name: (grants.name ?? '').replace(/\{\{starter_spell\}\}/g, classData.starter_spell?.name ?? ''),
      signature: (grants.signature ?? '').replace(/\{\{starter_spell\}\}/g, starter_spell_sig || ''),
    };
  }

  return result;
}
