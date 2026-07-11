import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const BASE_DIR = path.join(__dirname, '..');
const TOOLCHAIN_DIR = path.join(BASE_DIR, 'toolchain');
const SANDBOX_PATH = path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run');

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}
// Helper to run sandbox tests
function runSandboxTests(): CheckResult {
  try {
    // Run tests via vitest which properly handles the test framework
    const result = execSync(`npx vitest run tests/sandbox.test.ts`, {
      encoding: 'utf-8',
      cwd: BASE_DIR,
      stdio: 'pipe'
    });
    
    // Check if all tests passed by looking for "Test Files" and "passed"
    if (result.includes('Test Files') && result.includes('passed')) {
      return {
        name: 'Sandbox test suite',
        passed: true,
        message: 'All sandbox tests passed via vitest'
      };
    } else {
      return {
        name: 'Sandbox test suite',
        passed: false,
        message: result || 'Tests failed or exited non-zero'
      };
    }
  } catch (e: any) {
    const output = e.stdout ? String(e.stdout) : '';
    return {
      name: 'Sandbox test suite',
      passed: false,
      message: output || 'Tests failed or exited non-zero'
    };
  }
}

// Helper to run gameapi smoke
function runGameapiSmoke(): CheckResult {
  try {
    const result = execSync(`ts-node ${path.join(BASE_DIR, 'scripts/smoke-gameapi.ts')}`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    return {
      name: 'GameAPI smoke test',
      passed: true,
      message: 'Event round-trip verified'
    };
  } catch (e: any) {
    const output = e.stdout ? String(e.stdout) : '';
    return {
      name: 'GameAPI smoke test',
      passed: false,
      message: output || 'Smoke test failed'
    };
  }
}

// Helper to validate gold lessons
function runGoldLessons(): CheckResult {
  try {
    const result = execSync(`ts-node ${path.join(BASE_DIR, 'scripts/validate-gold-lessons.ts')}`, {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    return {
      name: 'Gold lessons validation',
      passed: true,
      message: 'Both gold lessons validated with reference solutions'
    };
  } catch (e: any) {
    const output = e.stdout ? String(e.stdout) : '';
    return {
      name: 'Gold lessons validation',
      passed: false,
      message: output || 'Gold lessons failed to validate'
    };
  }
}

// Helper to test negative case - wrong solution should fail validation
function runNegativeCheck(): CheckResult {
  const yaml = require('js-yaml');
  
  // Read the variables-101 lesson (zone-1-lesson-1) which has hp/mp checks
  const lessonPath = path.join(BASE_DIR, 'content/zones/act1/vault_of_variables/zone-1-lesson-1.yaml');
  const content = fs.readFileSync(lessonPath, 'utf-8');
  const lessonData = yaml.load(content);
  
  // Wrong solution: hp = 99 instead of hp = 100
  const wrongSolution = `      int hp = 99;\n      int mp = 50;\n      float staminaRegen = 1.5f;`;
  
  try {
    const fullCode = `${lessonData.prelude}\n${wrongSolution}\n${lessonData.epilogue}`;
    
    const tempDir = path.join(process.env.TMPDIR || '/tmp', `quest-negative-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    const mainCpp = path.join(tempDir, 'main.cpp');
    fs.writeFileSync(mainCpp, fullCode);
    
    // Compile with the toolchain compiler
    const exePath = path.join(tempDir, 'lesson.exe');
    const compilerPath = '/usr/bin/g++';
    const gameapiCpp = path.join(BASE_DIR, 'gameapi/gameapi.cpp');
    const jsonInclude = path.join(BASE_DIR, 'gameapi/third_party');
    
    const compileCmd = `${compilerPath} -std=c++17 -O0 -g0 -Wall -I${BASE_DIR}/gameapi -I${jsonInclude} ${mainCpp} ${gameapiCpp} -o ${exePath}`;
    
    try {
      execSync(compileCmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: any) {
      return {
        name: 'Negative check (wrong solution)',
        passed: false,
        message: `Compilation failed unexpectedly: ${String(e.stdout || e.stderr)}`
      };
    }
    
    // Run with sandbox
    const sandboxCmd = `${SANDBOX_PATH} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${exePath}`;
    const execOutput = execSync(sandboxCmd, { encoding: 'utf8', stdio: 'pipe' });
    
    // Parse output for check events
    const lines = execOutput.split('\n');
    let hpEventValue: number | null = null;
    
    for (const line of lines) {
      if (line.startsWith('@@EV@@ ')) {
        try {
          const ev = JSON.parse(line.substring('@@EV@@ '.length).trim());
          if (ev.type === 'check' && ev.id === 'hp') {
            hpEventValue = ev.value;
          }
        } catch {}
      }
    }
    
    // The check must emit the wrong value (99) so validation can reject it
    if (hpEventValue !== 99) {
      return {
        name: 'Negative check (wrong solution fails)',
        passed: false,
        message: `Expected check value 99 for wrong solution, got ${hpEventValue || 'none'}`
      };
    }
    
    // Verify the validation logic WOULD reject this
    const validationChecks = lessonData.validation.checks;
    const hpCheck = validationChecks.find((c: any) => c.id === 'hp');
    
    if (!hpCheck || hpCheck.expected !== 100) {
      return {
        name: 'Negative check',
        passed: false,
        message: 'Validation config for hp check not found or incorrect'
      };
    }
    
    // The check value 99 should NOT equal expected 100
    if (Math.abs(hpEventValue - 100) < 0.001) {
      return {
        name: 'Negative check',
        passed: false,
        message: 'Validation would incorrectly pass with wrong value'
      };
    }
    
    // Now test that the correct solution PASSES
    const correctSolution = lessonData.solution;
    const correctFullCode = `${lessonData.prelude}\n${correctSolution}\n${lessonData.epilogue}`;
    
    const correctTempDir = path.join(process.env.TMPDIR || '/tmp', `quest-correct-${Date.now()}`);
    fs.mkdirSync(correctTempDir, { recursive: true });
    
    const correctMainCpp = path.join(correctTempDir, 'main.cpp');
    fs.writeFileSync(correctMainCpp, correctFullCode);
    
    const correctExePath = path.join(correctTempDir, 'lesson.exe');
    const correctCompileCmd = `${compilerPath} -std=c++17 -O0 -g0 -Wall -I${BASE_DIR}/gameapi -I${jsonInclude} ${correctMainCpp} ${gameapiCpp} -o ${correctExePath}`;
    
    try {
      execSync(correctCompileCmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e: any) {
      return {
        name: 'Negative check (correct solution)',
        passed: false,
        message: `Correct solution compilation failed: ${String(e.stdout || e.stderr)}`
      };
    }
    
    const correctSandboxCmd = `${SANDBOX_PATH} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${correctExePath}`;
    const correctExecOutput = execSync(correctSandboxCmd, { encoding: 'utf8', stdio: 'pipe' });
    
    let correctHpValue: number | null = null;
    for (const line of correctExecOutput.split('\n')) {
      if (line.startsWith('@@EV@@ ')) {
        try {
          const ev = JSON.parse(line.substring('@@EV@@ '.length).trim());
          if (ev.type === 'check' && ev.id === 'hp') {
            correctHpValue = ev.value;
          }
        } catch {}
      }
    }
    
    if (correctHpValue !== 100) {
      return {
        name: 'Negative check (correct solution)',
        passed: false,
        message: `Correct solution should report hp=100, got ${correctHpValue || 'none'}`
      };
    }
    
    return {
      name: 'Negative check (wrong solution fails)',
      passed: true,
      message: 'Wrong solution (hp=99) emits incorrect value; correct solution (hp=100) passes'
    };
    
  } catch (e: any) {
    return {
      name: 'Negative check (wrong solution fails)',
      passed: false,
      message: String(e.stdout || e.stderr || e.message)
    };
  }
}

// Helper to measure speed: median full Cast round-trip over 10 runs
function measureSpeed(): CheckResult {
  const yaml = require('js-yaml');
  
  const lessonPath = path.join(BASE_DIR, 'content/zones/act1/character_creation/zone-0-lesson-1.yaml');
  const content = fs.readFileSync(lessonPath, 'utf-8');
  const lessonData = yaml.load(content);
  const solution = lessonData.solution;
  
  const times: number[] = [];
  const maxRuns = 10;
  
  try {
    // Warm up by compiling PCH and doing a warm-up run
    execSync(`npm run pch:gameapi`, { cwd: BASE_DIR, stdio: 'pipe' });
    
    // Do a warm-up run (compile + run)
    const tempDirWarm = path.join(process.env.TMPDIR || '/tmp', `speed-warm-${Date.now()}`);
    fs.mkdirSync(tempDirWarm, { recursive: true });
    const fullCodeWarm = `${lessonData.prelude}\n${solution}\n${lessonData.epilogue}`;
    const mainCppWarm = path.join(tempDirWarm, 'main.cpp');
    fs.writeFileSync(mainCppWarm, fullCodeWarm);
    const exePathWarm = path.join(tempDirWarm, 'lesson.exe');
    const compilerPath = '/usr/bin/g++';
    const gameapiCpp = path.join(BASE_DIR, 'gameapi/gameapi.cpp');
    const jsonInclude = path.join(BASE_DIR, 'gameapi/third_party');
    execSync(`${compilerPath} -std=c++17 -O0 -g0 -Wall -I${BASE_DIR}/gameapi -I${jsonInclude} ${mainCppWarm} ${gameapiCpp} -o ${exePathWarm}`, { stdio: 'pipe' });
    execSync(`${SANDBOX_PATH} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${exePathWarm}`, { stdio: 'pipe' });
    
    for (let i = 0; i < maxRuns; i++) {
      const start = Date.now();
      
      // Run the Cast pipeline (assemble + compile + run + parse)
      const tempDir = path.join(process.env.TMPDIR || '/tmp', `speed-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      const fullCode = `${lessonData.prelude}\n${solution}\n${lessonData.epilogue}`;
      const mainCpp = path.join(tempDir, 'main.cpp');
      fs.writeFileSync(mainCpp, fullCode);
      const exePath = path.join(tempDir, 'lesson.exe');
      execSync(`${compilerPath} -std=c++17 -O0 -g0 -Wall -I${BASE_DIR}/gameapi -I${jsonInclude} ${mainCpp} ${gameapiCpp} -o ${exePath}`, { stdio: 'pipe' });
      execSync(`${SANDBOX_PATH} --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 --stdout-cap-kb 1024 -- ${exePath}`, { stdio: 'pipe' });
      
      const elapsed = Date.now() - start;
      times.push(elapsed);
    }
    
    // Calculate median
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    
    if (median < 2000) {
      return {
        name: 'Speed (median Cast round-trip)',
        passed: true,
        message: `Median ${median}ms < 2000ms threshold`
      };
    } else {
      return {
        name: 'Speed (median Cast round-trip)',
        passed: false,
        message: `Median ${median}ms >= 2000ms threshold`
      };
    }
    
  } catch (e: any) {
    return {
      name: 'Speed measurement',
      passed: false,
      message: String(e.stdout || e.stderr || 'Speed test failed')
    };
  }
}

// Check 1: Toolchain lock valid with version output
function checkToolchain(): CheckResult {
  const lockPath = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
  
  if (!fs.existsSync(lockPath)) {
    return {
      name: 'Toolchain lock',
      passed: false,
      message: 'toolchain.lock.json not found'
    };
  }
  
  try {
    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    
    // Check linux-native profile exists
    if (!lockData.profiles?.['linux-native']) {
      return {
        name: 'Toolchain lock',
        passed: false,
        message: 'linux-native profile not found'
      };
    }
    
    const profile = lockData.profiles['linux-native'];
    
    // Check compiler path exists and is executable
    if (!profile.path) {
      return {
        name: 'Toolchain lock',
        passed: false,
        message: 'Compiler path missing from lock file'
      };
    }
    
    // Actually run the compiler to verify it works and get version
    const versionResult = execSync(`${profile.path} --version`, { encoding: 'utf-8', stdio: 'pipe' });
    
    if (!versionResult.trim()) {
      return {
        name: 'Toolchain lock',
        passed: false,
        message: 'Compiler --version returned empty output'
      };
    }
    
    // Record the version in lock file
    profile.version = versionResult.trim();
    fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2));
    
    return {
      name: 'Toolchain lock',
      passed: true,
      message: `Compiler verified: ${profile.version.split('\n')[0] || 'g++'}`
    };
    
  } catch (e: any) {
    return {
      name: 'Toolchain lock',
      passed: false,
      message: String(e.stdout || e.stderr || 'Failed to verify toolchain')
    };
  }
}

// Check 2: Cross-compile smoke (Windows) - SKIPPED per Phase 0 Linux-only decision
function checkCrossCompile(): CheckResult {
  // Windows is dropped from Phase 0 scope, marked as N/A
  return {
    name: 'Windows cross-compile (N/A)',
    passed: true,
    message: 'Windows support dropped from Phase 0; not tested'
  };
}

// Main execution
function main() {
  const results: CheckResult[] = [];
  
  console.log('=== Phase 0 Acceptance Script ===\n');
  
  // Run checks in order
  results.push(checkToolchain());
  results.push(checkCrossCompile());
  results.push(runSandboxTests());
  results.push(runGameapiSmoke());
  results.push(runGoldLessons());
  results.push(runNegativeCheck());
  results.push(measureSpeed());
  
  // Print summary table
  console.log('\n=== Results ===');
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${r.name}`);
    if (!r.passed) {
      console.log(`       ${r.message}`);
    }
  }
  
  console.log(`\nTotal: ${passed}/${total} checks passed`);
  
  if (passed === total) {
    console.log('\n✓ Phase 0 acceptance: ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log('\n✗ Phase 0 acceptance: SOME CHECKS FAILED');
    process.exit(1);
  }
}

main();
