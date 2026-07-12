import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import { writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, isAbsolute } from 'path';

const IS_WINDOWS = process.platform === 'win32';
const EXE_SUFFIX = IS_WINDOWS ? '.exe' : '';

const SANDBOX_PATH = join(__dirname, '..', 'toolchain', 'bin', `sandbox_run${EXE_SUFFIX}`);

// Resolve the fixture compiler the same way the runner does (toolchain lock
// profile per platform; repo-relative paths for fetched profiles) instead of
// assuming a bare `g++` on PATH; fall back to PATH lookup when the profile's
// binary isn't present (e.g. CI before toolchain:fetch, using MSYS2's g++).
function resolveTestCompiler(): string {
  try {
    const lockPath = join(__dirname, '..', 'toolchain', 'toolchain.lock.json');
    const lockData = JSON.parse(readFileSync(lockPath, 'utf-8'));
    const profileKey = IS_WINDOWS ? 'windows-native' : 'linux-native';
    const profilePath = lockData.profiles?.[profileKey]?.path;
    if (profilePath) {
      const resolved = isAbsolute(profilePath) ? profilePath : join(__dirname, '..', profilePath);
      if (existsSync(resolved)) return resolved;
    }
  } catch {}
  return 'g++';
}

const TEST_COMPILER = resolveTestCompiler();

describe('Sandbox Tests', () => {
  function compileFixture(name: string, source: string): string {
    const path = join(__dirname, 'fixtures', `${name}_fixture`);
    const exe = path + EXE_SUFFIX;
    writeFileSync(path + '.cpp', source);
    spawnSync(TEST_COMPILER, ['-std=c++17', '-O0', '-g0', path + '.cpp', '-o', exe], { stdio: 'inherit' });
    return exe;
  }

  function cleanupFixture(exe: string): void {
    rmSync(exe.replace(/\.exe$/, '') + '.cpp', { force: true });
    try { rmSync(exe, { force: true }); } catch {}
  }

  beforeAll(() => {
    // Ensure sandbox binary exists and is executable
    expect(SANDBOX_PATH).toMatch(/sandbox_run/);
  });

  it('should kill process on wall timeout', () => {
    // Only fixture that needs a platform branch: sleep() lives in unistd.h on
    // POSIX, Sleep() in windows.h. Everything else in this suite is portable
    // C++ shared verbatim across platforms (deliberate — see WINDOWS_PHASE.md
    // WP-4 on why the staged sandbox_run/tests/*.cpp fixtures were NOT wired
    // in: test_memory.cpp's `if (!ptr) break` exits cleanly instead of
    // crashing, so it never exercises the killed_by:"memory" path).
    const source = IS_WINDOWS
      ? `#include <cstdio>
#include <windows.h>
int main() {
    while (1) Sleep(1000);
    return 0;
}`
      : `#include <cstdio>
#include <unistd.h>
int main() {
    while (1) sleep(1);
    return 0;
}`;
    const path = compileFixture('wall_timeout', source);

    try {
      const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '500', '--cpu-ms', '2000', '--mem-mb', '64', '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
      const output = res.stdout || '';
      expect(output).toContain('"killed_by":"wall_timeout"');
    } finally {
      cleanupFixture(path);
    }
  });

  it('should kill process on memory limit', () => {
    // Allocations must ACCUMULATE to hit RLIMIT_AS; new[] throws bad_alloc at
    // the limit, which the sandbox classifies as killed_by=memory.
    const source = `#include <cstdio>
int main() {
    while (1) {
        volatile char* ptr = new char[1024 * 1024];
        ptr[0] = 1;
    }
    return 0;
}`;
    const path = compileFixture('memory', source);

    try {
      const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '10000', '--cpu-ms', '2000', '--mem-mb', '32', '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
      const output = res.stdout || '';
      expect(output).toContain('"killed_by":"memory"');
    } finally {
      cleanupFixture(path);
    }
  });

  it('should handle stack overflow', () => {
    const source = `#include <cstdio>
void recurse(int depth) {
    char buffer[4096];
    buffer[0] = depth % 256;
    recurse(depth + 1);
}
int main() {
    printf("Stack overflow test\\n");
    recurse(0);
    return 0;
}`;
    const path = compileFixture('stack_overflow', source);

    try {
      const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '10000', '--cpu-ms', '2000', '--mem-mb', '64', '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
      const output = res.stdout || '';
      // Stack overflow arrives as SIGSEGV; the validator's stack_overflow row
      // matches killed_by=sigsegv (see EXIT_STATUS_ROWS in runner/src/validator.ts)
      expect(output).toContain('"killed_by":"sigsegv"');
    } finally {
      cleanupFixture(path);
    }
  });

  it('should pipe stdin to process', () => {
    const source = `#include <cstdio>
int main() {
    char buffer[4096];
    if (fgets(buffer, sizeof(buffer), stdin)) {
        printf("%s", buffer);
    }
    return 0;
}`;
    const path = compileFixture('stdin', source);

    try {
      const stdinFile = join(tmpdir(), `sandbox_stdin_${Date.now()}.txt`);
      writeFileSync(stdinFile, 'test_stdin_input\\n');

      try {
        const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '5000', '--cpu-ms', '2000', '--mem-mb', '64', '--stdin-file', stdinFile, '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
        const output = res.stdout || '';
        expect(output).toContain('test_stdin_input');
      } finally {
        rmSync(stdinFile, { force: true });
      }
    } finally {
      cleanupFixture(path);
    }
  });

  it('should cap stdout output', () => {
    const source = `#include <cstdio>
int main() {
    for (int i = 0; i < 500; i++) {
        printf("Line %d\\n", i);
    }
    return 0;
}`;
    const path = compileFixture('output_cap', source);

    try {
      const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '5000', '--cpu-ms', '2000', '--mem-mb', '64', '--stdout-cap-kb', '1', '--', path], { encoding: 'utf-8' });
      const output = res.stdout || '';
      expect(output).toContain('"killed_by":"output_cap"');
    } finally {
      cleanupFixture(path);
    }
  });

  it('should have low overhead for null operation', () => {
    const source = `#include <cstdio>
int main() {
    return 0;
}`;
    const path = compileFixture('null_op', source);

    try {
      const times: number[] = [];

      for (let i = 0; i < 10; i++) {
        try {
          const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '5000', '--cpu-ms', '2000', '--mem-mb', '64', '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
          const output = res.stdout || '';
          const match = /"wall_ms":(\d+)/.exec(output);
          if (match) {
            times.push(parseInt(match[1], 10));
          }
        } catch (e: any) {
          expect.fail(`Run ${i} failed`);
        }
      }

      times.sort((a, b) => a - b);
      const median = times[Math.floor(times.length / 2)];
      expect(median).toBeLessThan(50);
    } finally {
      cleanupFixture(path);
    }
  });
});
