import { spawnSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SANDBOX_PATH = '/home/serenity/.hermes/coding/quest-for-data/Quest-for-Data-codebase/toolchain/bin/sandbox_run';

interface TestResult {
    name: string;
    passed: boolean;
    reason?: string;
}

function compileFixture(name: string, source: string): string {
    const path = join('/home/serenity/.hermes/coding/quest-for-data/Quest-for-Data-codebase/tests/fixtures', `${name}_fixture`);
    writeFileSync(path + '.cpp', source);
    spawnSync('g++', ['-std=c++17', '-O0', '-g0', path + '.cpp', '-o', path], { stdio: 'inherit' });
    return path;
}

function runWallTimeoutTest(): TestResult {
    const source = `#include <cstdio>
#include <unistd.h>
int main() {
    while (1) sleep(1);
    return 0;
}
`;
    const path = compileFixture('wall_timeout', source);

    try {
        const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '500', '--cpu-ms', '2000', '--mem-mb', '64', '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
        const output = res.stdout || '';
        if (output.includes('"killed_by":"wall_timeout"')) {
            return { name: 'Wall timeout', passed: true };
        }
        return { name: 'Wall timeout', passed: false, reason: `Expected wall_timeout, got: ${output}` };
    } finally {
        rmSync(path + '.cpp', { force: true });
        try { rmSync(path, { force: true }); } catch {}
    }
}

function runMemoryTest(): TestResult {
    const source = `#include <cstdio>
#include <cstdlib>
#include <unistd.h>
int main() {
    while (1) {
        void* ptr = malloc(1024 * 1024);
        if (!ptr) break;
        *(char*)ptr = 1;
        free(ptr);
    }
    return 0;
}
`;
    const path = compileFixture('memory', source);

    try {
        const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '10000', '--cpu-ms', '2000', '--mem-mb', '32', '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
        const output = res.stdout || '';
        if (output.includes('"killed_by":"memory"')) {
            return { name: 'Memory limit', passed: true };
        }
        return { name: 'Memory limit', passed: false, reason: `Expected memory, got: ${output}` };
    } finally {
        rmSync(path + '.cpp', { force: true });
        try { rmSync(path, { force: true }); } catch {}
    }
}

function runStackOverflowTest(): TestResult {
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
}
`;
    const path = compileFixture('stack_overflow', source);

    try {
        const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '10000', '--cpu-ms', '2000', '--mem-mb', '64', '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
        const output = res.stdout || '';
        if (output.includes('"killed_by":"memory"')) {
            return { name: 'Stack overflow', passed: true };
        }
        return { name: 'Stack overflow', passed: false, reason: `Expected memory/killed, got: ${output}` };
    } finally {
        rmSync(path + '.cpp', { force: true });
        try { rmSync(path, { force: true }); } catch {}
    }
}

function runStdinTest(): TestResult {
    const source = `#include <cstdio>
int main() {
    char buffer[4096];
    if (fgets(buffer, sizeof(buffer), stdin)) {
        printf("%s", buffer);
    }
    return 0;
}
`;
    const path = compileFixture('stdin', source);

    try {
        const stdinFile = join(tmpdir(), `sandbox_stdin_${Date.now()}.txt`);
        writeFileSync(stdinFile, 'test_stdin_input\n');

        try {
            const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '5000', '--cpu-ms', '2000', '--mem-mb', '64', '--stdin-file', stdinFile, '--stdout-cap-kb', '128', '--', path], { encoding: 'utf-8' });
            const output = res.stdout || '';
            if (output.includes('test_stdin_input')) {
                return { name: 'Stdin piping', passed: true };
            }
            return { name: 'Stdin piping', passed: false, reason: `Expected stdin content in output, got: ${output}` };
        } finally {
            rmSync(stdinFile, { force: true });
        }
    } finally {
        rmSync(path + '.cpp', { force: true });
        try { rmSync(path, { force: true }); } catch {}
    }
}

function runOutputCapTest(): TestResult {
    const source = `#include <cstdio>
int main() {
    for (int i = 0; i < 500; i++) {
        printf("Line %d\\n", i);
    }
    return 0;
}
`;
    const path = compileFixture('output_cap', source);

    try {
        const res = spawnSync(SANDBOX_PATH, ['--wall-ms', '5000', '--cpu-ms', '2000', '--mem-mb', '64', '--stdout-cap-kb', '1', '--', path], { encoding: 'utf-8' });
        const output = res.stdout || '';
        if (output.includes('"killed_by":"output_cap"')) {
            return { name: 'Output cap', passed: true };
        }
        return { name: 'Output cap', passed: false, reason: `Expected output_cap, got: ${output}` };
    } finally {
        rmSync(path + '.cpp', { force: true });
        try { rmSync(path, { force: true }); } catch {}
    }
}

function runNullOpOverheadTest(): TestResult {
    const source = `#include <cstdio>
int main() {
    return 0;
}
`;
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
                return { name: 'Null op overhead', passed: false, reason: `Run ${i} failed` };
            }
        }

        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)];

        if (median < 50) {
            return { name: 'Null op overhead', passed: true, reason: `Median ${median}ms < 50ms` };
        }
        return { name: 'Null op overhead', passed: false, reason: `Median ${median}ms >= 50ms` };
    } finally {
        rmSync(path + '.cpp', { force: true });
        try { rmSync(path, { force: true }); } catch {}
    }
}

const tests = [
    runWallTimeoutTest,
    runMemoryTest,
    runStackOverflowTest,
    runStdinTest,
    runOutputCapTest,
    runNullOpOverheadTest
];

let allPassed = true;
for (const test of tests) {
    const result = test();
    if (!result.passed) {
        console.error(`FAIL: ${result.name}: ${result.reason}`);
        allPassed = false;
    } else {
        console.log(`PASS: ${result.name}`);
    }
}

process.exit(allPassed ? 0 : 1);
