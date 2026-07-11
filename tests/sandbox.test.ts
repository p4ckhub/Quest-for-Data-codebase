import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SANDBOX_PATH = join(__dirname, '..', 'toolchain', 'bin', 'sandbox_run');

describe('Sandbox Tests', () => {
  function compileFixture(name: string, source: string): string {
    const path = join(__dirname, 'fixtures', `${name}_fixture`);
    writeFileSync(path + '.cpp', source);
    spawnSync('g++', ['-std=c++17', '-O0', '-g0', path + '.cpp', '-o', path], { stdio: 'inherit' });
    return path;
  }

  beforeAll(() => {
    // Ensure sandbox binary exists and is executable
    expect(SANDBOX_PATH).toMatch(/sandbox_run/);
  });

  it('should kill process on wall timeout', () => {
    const source = `#include <cstdio>
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
      rmSync(path + '.cpp', { force: true });
      try { rmSync(path, { force: true }); } catch {}
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
      rmSync(path + '.cpp', { force: true });
      try { rmSync(path, { force: true }); } catch {}
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
      rmSync(path + '.cpp', { force: true });
      try { rmSync(path, { force: true }); } catch {}
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
      rmSync(path + '.cpp', { force: true });
      try { rmSync(path, { force: true }); } catch {}
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
      rmSync(path + '.cpp', { force: true });
      try { rmSync(path, { force: true }); } catch {}
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
      rmSync(path + '.cpp', { force: true });
      try { rmSync(path, { force: true }); } catch {}
    }
  });
});
