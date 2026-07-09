const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const TOOLCHAIN_DIR = path.join(__dirname, '../../toolchain');
const PCH_PATH = path.join(TOOLCHAIN_DIR, 'pch', 'linux-native', 'gameapi.gch');

function runLesson(lesson, playerCode) {
  return new Promise((resolve, reject) => {
    try {
      // 1. Assemble main.cpp
      const fullCode = `${lesson.prelude || ''}\n${playerCode}\n${lesson.epilogue || ''}`;
      
      const tempDir = path.join(process.env.TMPDIR || '/tmp', `quest-${lesson.id}-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      
      const mainCpp = path.join(tempDir, 'main.cpp');
      fs.writeFileSync(mainCpp, fullCode);
      
      // 2. Compile with linux-native toolchain
      const exePath = path.join(tempDir, 'lesson.exe');
      const compileCmd = `clang++ -std=c++17 -O0 -g0 -Wall -fno-color-diagnostics -include-pch ${PCH_PATH} -I${TOOLCHAIN_DIR}/../gameapi ${mainCpp} -o ${exePath}`;
      
      let compileOutput = '';
      let compileSuccessful = true;
      
      try {
        compileOutput = execSync(compileCmd, { encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        compileSuccessful = false;
        compileOutput = e.stdout ? String(e.stdout) : '';
        const stderr = e.stderr ? String(e.stderr) : '';
        if (stderr) compileOutput += '\n' + stderr;
      }
      
      if (!compileSuccessful) {
        resolve({
          success: false,
          output: '',
          compileError: compileOutput
        });
        return;
      }
      
      // 3. Execute under sandbox_run with default limits
      const sandboxCmd = `${path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run')} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${exePath}`;
      
      let execOutput = '';
      try {
        execOutput = execSync(sandboxCmd, { encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        // sandbox_run returns 0 but may have killed the process
        execOutput = e.stdout ? String(e.stdout) : '';
        if (e.stderr) execOutput += String(e.stderr);
      }
      
      // 4. Parse @@EV@@ events and @@RESULT@@ line
      const { events, result } = parseExecutionOutput(execOutput);
      
      // 5. Map outcome to game result
      const outcome = mapOutcome(result);
      
      resolve({
        success: outcome.success,
        output: formatOutput(events, result, outcome),
        error: outcome.error,
        messages: outcome.messages
      });
      
    } catch (error) {
      resolve({ 
        success: false, 
        output: '', 
        error: error.message,
        compileError: error.message
      });
    }
  });
}

function parseExecutionOutput(output) {
  const events = [];
  let resultLine = '';
  
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.startsWith('@@EV@@ ')) {
      const jsonStr = line.substring('@@EV@@ '.length).trim();
      try {
        events.push(JSON.parse(jsonStr));
      } catch (e) {
        // Malformed JSON - skip or log warning
      }
    } else if (line.startsWith('@@RESULT@@ ')) {
      resultLine = line;
    }
  }
  
  let result = { exit_code: 0, wall_ms: 0, cpu_ms: 0, killed_by: null };
  
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
    } catch (e) {
      // If parsing fails, keep default result
    }
  }
  
  return { events, result };
}

function mapOutcome(result) {
  const messages = [];
  
  if (result.exit_code === 0 && result.killed_by === null) {
    // Clean exit - validation will happen separately
    return { success: true, messages };
  }
  
  let error;
  
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

function formatOutput(events, result, outcome) {
  const lines = [];
  
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

module.exports = { runLesson };
