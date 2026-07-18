import { ExecutionResult } from './index';

// §11.4 validator — the one and only validation pipeline.
// Evaluates a lesson's validation.checks against the parsed sandbox output
// (events + @@RESULT@@) plus, for source_matches, the player's source text.

export interface CheckSpec {
  type: 'check_equals' | 'check_in_range' | 'stdout_contains' | 'stdout_matches' | 'event_emitted' | 'exit_status' | 'source_matches';
  id?: string;
  expected?: number | string;
  tolerance?: number;
  min?: number;
  max?: number;
  text?: string;
  regex?: string;
  event_type?: string;
  match?: Record<string, unknown>;
  expect?: string;
  expect_match?: boolean;  // source_matches: false = the pattern must NOT appear (default true)
  message?: string;        // source_matches: authored failure text shown to the player
}

export interface CheckResult {
  type: string;
  id?: string;          // check id for check_* types (drives check_failed:<id> hints)
  passed: boolean;
  message: string;      // game-terms failure description; empty on pass
}

export interface ValidationResult {
  passed: boolean;
  checks: CheckResult[];
  failedCheckIds: string[]; // ids usable for hint triggers `check_failed:<id>`
}

// §10.5 exit-status rows a lesson may require via `exit_status.expect`
const EXIT_STATUS_ROWS: Record<string, (r: ExecutionResult, stderrText: string) => boolean> = {
  clean: (r) => r.exit_code === 0 && r.killed_by === null,
  nonzero: (r) => r.exit_code !== 0 && r.killed_by === null,
  timeout: (r) => r.killed_by === 'wall_timeout' || r.killed_by === 'cpu_timeout',
  stack_overflow: (r) =>
    r.exit_code === 3221225725 /* 0xC00000FD windows */ ||
    (r.killed_by === null && (r.exit_code === 139 || r.exit_code === 11 || r.exit_code === 132)) ||
    r.killed_by === 'sigsegv',
  access_violation: (r) =>
    r.exit_code === 3221225477 /* 0xC0000005 windows */ ||
    r.exit_code === 139 || r.killed_by === 'sigsegv',
  out_of_memory: (r, stderrText) => r.killed_by === 'memory' || /bad_alloc/.test(stderrText),
  output_flood: (r) => r.killed_by === 'output_cap',
};

interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface ValidatorInput {
  events: GameEvent[];
  result: ExecutionResult;
  rawStdout: string;   // non-event stdout lines, joined
  rawStderr?: string;
  playerSource?: string; // the player's editor text (source_matches runs against this, not the assembled file)
}

export function evaluateChecks(checks: CheckSpec[], input: ValidatorInput): ValidationResult {
  const results: CheckResult[] = [];

  for (const check of checks) {
    results.push(evaluateOne(check, input));
  }

  const failed = results.filter((r) => !r.passed);
  return {
    passed: failed.length === 0,
    checks: results,
    failedCheckIds: failed.filter((r) => r.id).map((r) => r.id as string),
  };
}

function evaluateOne(check: CheckSpec, input: ValidatorInput): CheckResult {
  switch (check.type) {
    case 'check_equals':
      return checkEquals(check, input.events);
    case 'check_in_range':
      return checkInRange(check, input.events);
    case 'stdout_contains':
      return {
        type: check.type,
        id: check.id,
        passed: input.rawStdout.includes(check.text ?? ''),
        message: input.rawStdout.includes(check.text ?? '')
          ? ''
          : `The incantation's voice never spoke the words "${check.text}".`,
      };
    case 'stdout_matches': {
      const re = new RegExp(check.regex ?? '');
      const ok = re.test(input.rawStdout);
      console.log('DEBUG regex source:', JSON.stringify(re.source));
      console.log('DEBUG testing against:', JSON.stringify(input.rawStdout));
      console.log('DEBUG result:', re.test(input.rawStdout));
      return {
        type: check.type,
        id: check.id,
        passed: ok,
        message: ok ? '' : `The incantation's voice did not follow the expected pattern.`,
      };
    }
    case 'event_emitted': {
      const ok = input.events.some(
        (ev) =>
          ev.type === check.event_type &&
          Object.entries(check.match ?? {}).every(([k, v]) => (ev as Record<string, unknown>)[k] === v)
      );
      return {
        type: check.type,
        id: check.id,
        passed: ok,
        message: ok ? '' : `Expected magic of kind "${check.event_type}" never manifested.`,
      };
    }
    case 'source_matches': {
      const re = new RegExp(check.regex ?? '', 'm');
      const found = re.test(input.playerSource ?? '');
      const wantMatch = check.expect_match !== false;
      const ok = found === wantMatch;
      const fallback = wantMatch
        ? 'The scroll is missing a required inscription.'
        : 'The scroll carries a forbidden inscription.';
      return {
        type: check.type,
        id: check.id,
        passed: ok,
        message: ok ? '' : (check.message ?? fallback),
      };
    }
    case 'exit_status': {
      const expect = check.expect ?? 'clean';
      const rowFn = EXIT_STATUS_ROWS[expect];
      const ok = rowFn ? rowFn(input.result, input.rawStderr ?? '') : false;
      return {
        type: check.type,
        id: check.id,
        passed: ok,
        message: ok ? '' : exitStatusFailureMessage(expect, input.result),
      };
    }
    default:
      return {
        type: (check as CheckSpec).type ?? 'unknown',
        passed: false,
        message: `Unknown check type "${(check as CheckSpec).type}" — content bug, report it.`,
      };
  }
}

function findCheckEvent(events: GameEvent[], id: string): GameEvent | undefined {
  // Last report wins (harnesses may report progressively)
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'check' && events[i].id === id) return events[i];
  }
  return undefined;
}

function checkEquals(check: CheckSpec, events: GameEvent[]): CheckResult {
  const ev = findCheckEvent(events, check.id ?? '');
  if (!ev) {
    return {
      type: check.type, id: check.id, passed: false,
      message: `The crystal "${check.id}" never lit — nothing was reported for it.`,
    };
  }
  const value = ev.value;
  const expected = check.expected;
  let ok: boolean;
  if (typeof expected === 'number' && typeof value === 'number') {
    const tolerance = check.tolerance ?? 1e-3;
    ok = Math.abs(value - expected) <= tolerance;
  } else {
    ok = String(value) === String(expected);
  }
  return {
    type: check.type, id: check.id, passed: ok,
    message: ok ? '' : `The crystal flickered but didn't hold — ${check.id} should be ${expected}, got ${value}.`,
  };
}

function checkInRange(check: CheckSpec, events: GameEvent[]): CheckResult {
  const ev = findCheckEvent(events, check.id ?? '');
  if (!ev) {
    return {
      type: check.type, id: check.id, passed: false,
      message: `The crystal "${check.id}" never lit — nothing was reported for it.`,
    };
  }
  const value = Number(ev.value);
  const ok = !Number.isNaN(value) && value >= (check.min ?? -Infinity) && value <= (check.max ?? Infinity);
  return {
    type: check.type, id: check.id, passed: ok,
    message: ok ? '' : `${check.id} must stay within [${check.min}, ${check.max}] — got ${value}.`,
  };
}

function exitStatusFailureMessage(expect: string, r: ExecutionResult): string {
  if (expect === 'clean') {
    if (r.killed_by === 'wall_timeout' || r.killed_by === 'cpu_timeout') {
      return 'Your spell rages beyond control — the Compiler severs it. (Is a loop failing to end?)';
    }
    if (r.killed_by === 'memory') return 'The spell devoured all the aether it was granted.';
    if (r.killed_by === 'output_cap') return 'The incantation babbles endlessly; the Compiler silences it.';
    if (r.exit_code === 139 || r.exit_code === 3221225477) return 'The spell struck forbidden memory and shattered.';
    return `The incantation collapsed before completing (exit code ${r.exit_code}).`;
  }
  // Lessons that REQUIRE a crash (e.g. stack_overflow rows) fail when the program exits some other way
  return `The trial demanded the incantation end as "${expect}" — it did not (exit code ${r.exit_code}, killed_by ${r.killed_by ?? 'null'}).`;
}
