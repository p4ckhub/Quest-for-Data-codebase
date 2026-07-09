import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';

const TOOLCHAIN_DIR = path.join(__dirname, '../../toolchain');

// Read compiler path from toolchain lock file
function getCompilerPath(): string {
  const lockPath = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  const linuxNative = lockData.profiles?.['linux-native'];
  if (linuxNative && linuxNative.path) {
    return linuxNative.path;
  }
  // Fallback to g++ if not found
  return '/usr/bin/g++';
}

const PCH_PATH = path.join(TOOLCHAIN_DIR, 'pch', 'linux-native', 'gameapi.pch');
const USE_PCH = false; // PCH not compatible with g++, disabled
const COMPILER_PATH = getCompilerPath();

export interface Lesson {
  id: string;
  kind: 'program' | 'functions';
  objective: string;
  starter_code: string;
  prelude?: string;
  epilogue?: string;
  harness?: string;
  validation?: Validation;
  hints?: Hint[];
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
  success: boolean;
  output: string;
  error?: string;
  compileError?: string;
  messages?: string[];
}

export async function runLesson(lesson: Lesson, playerCode: string): Promise<RunResult> {
  try {
    // 1. Assemble main.cpp
    const fullCode = `${lesson.prelude || ''}\n${playerCode}\n${lesson.epilogue || ''}`;
    
    const tempDir = path.join(process.env.TMPDIR || '/tmp', `quest-${lesson.id}-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    const mainCpp = path.join(tempDir, 'main.cpp');
    fs.writeFileSync(mainCpp, fullCode);
    
    // 2. Compile with linux-native toolchain
    const exePath = path.join(tempDir, 'lesson.exe');
    const pchFlag = USE_PCH ? `-include-pch ${PCH_PATH}` : '';
    const gameapiCpp = path.join(TOOLCHAIN_DIR, '..', 'gameapi', 'gameapi.cpp');
    const jsonInclude = path.join(TOOLCHAIN_DIR, '..', 'gameapi', 'third_party');
    
    let extraSources = `${mainCpp} ${gameapiCpp}`;
    
    // For kind=functions, include the harness file (player functions + harness main)
    if (lesson.kind === 'functions' && lesson.harness) {
      const harnessPath = path.join(TOOLCHAIN_DIR, '..', 'gameapi', lesson.harness);
      extraSources = `${mainCpp} ${harnessPath} ${gameapiCpp}`;
    }
    
    const compileCmd = `${COMPILER_PATH} -std=c++17 -O0 -g0 -Wall ${pchFlag} -I${TOOLCHAIN_DIR}/../gameapi -I${jsonInclude} ${extraSources} -o ${exePath}`;
    
    let compileOutput: string;
    let compileSuccessful = true;
    
    try {
      compileOutput = execSync(compileCmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: any) {
      compileSuccessful = false;
      compileOutput = e.stdout ? String(e.stdout) : '';
      const stderr = e.stderr ? String(e.stderr) : '';
      if (stderr) compileOutput += '\n' + stderr;
    }
    
    if (!compileSuccessful) {
      return {
        success: false,
        output: '',
        compileError: compileOutput
      };
    }
    
    // 3. Execute under sandbox_run with default limits
    const sandboxCmd = `${path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run')} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${exePath}`;
    
    let execOutput: string;
    try {
      execOutput = execSync(sandboxCmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: any) {
      // sandbox_run returns 0 but may have killed the process
      execOutput = e.stdout ? String(e.stdout) : '';
      if (e.stderr) execOutput += String(e.stderr);
    }
    
    // 4. Parse @@EV@@ events and @@RESULT@@ line
    const { events, result } = parseExecutionOutput(execOutput);
    
    // 5. Map outcome to game result
    const outcome = mapOutcome(result);
    
    return {
      success: outcome.success,
      output: formatOutput(events, result, outcome),
      error: outcome.error,
      messages: outcome.messages
    };
    
  } catch (error: any) {
    return { 
      success: false, 
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
}

export function parseExecutionOutput(output: string): ParsedOutput {
  const events: any[] = [];
  let resultLine = '';
  
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.startsWith('@@EV@@ ')) {
      const jsonStr = line.substring('@@EV@@ '.length).trim();
      try {
        events.push(JSON.parse(jsonStr));
      } catch (e: any) {
        // Malformed JSON - skip or log warning
      }
    } else if (line.startsWith('@@RESULT@@ ')) {
      resultLine = line;
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
  
  return { events, result };
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
