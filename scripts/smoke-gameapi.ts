import { spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_CODE = `#include "gameapi.h"
int main() {
    gameapi::log("hello");
    return 0;
}
`;

function getCompilerProfile(): { path: string; extraFlags: string[] } {
  const PROJECT_ROOT = path.join(__dirname, '..');
  const TOOLCHAIN_DIR = path.join(PROJECT_ROOT, 'toolchain');
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

async function main(): Promise<void> {
    const workdir = process.cwd();

    // Create temp dir for test
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-gameapi-'));

    try {
        // Write source files to temp dir
        fs.writeFileSync(path.join(tmpDir, 'main.cpp'), TEST_CODE);

        // Paths
        const compilerProfile = getCompilerProfile();
        const gxx = compilerProfile.path;
        const gameapiPath = path.join(workdir, 'gameapi');
        const thirdPartyPath = path.join(workdir, 'gameapi', 'third_party');
        
        // Check for PCH (GCC uses .gch in same directory as header)
        const pchPath = path.join(gameapiPath, 'gameapi.h.gch');
        if (!fs.existsSync(pchPath)) {
            console.error('PCH not found. Run: npm run pch:gameapi');
            process.exit(1);
        }
        
        const compileCmd = [
            gxx,
            '-std=c++17',
            '-O0', '-g0',
            '-I' + gameapiPath,
            '-I' + thirdPartyPath,
            path.join(workdir, 'gameapi', 'gameapi.cpp'),
            path.join(tmpDir, 'main.cpp'),
            '-o', path.join(tmpDir, 'test_gameapi')
        ];
        
        console.log('Compiling...');
        execSync(compileCmd.join(' '), { 
            stdio: 'inherit',
            cwd: tmpDir
        });
        
        // Run under sandbox_run
        const sandboxRun = path.join(workdir, 'toolchain', 'bin', 'sandbox_run');
        if (!fs.existsSync(sandboxRun)) {
            console.error('sandbox_run not found. Build it first.');
            process.exit(1);
        }
        
        const runCmd = `"${sandboxRun}" --wall-ms 5000 --mem-mb 256 "${path.join(tmpDir, 'test_gameapi')}"`;
        
        console.log('Running under sandbox_run...');
        console.log('Command:', runCmd);
        
        const sbResult = spawnSync(runCmd, { shell: true, encoding: 'utf8' });
        
        let output = (sbResult.stdout || '') + (sbResult.stderr || '');
        
        // Clean up trailing whitespace
        output = output.trim();
        
        console.log('Raw output:');
        console.log(output);
        console.log('Output repr:', JSON.stringify(output.substring(0, 150)));
        
        // Check for markers
        if (!output.includes('@@EV@@ ')) {
            console.error('No @@EV@@ line found');
            process.exit(1);
        }
        if (!output.includes('@@RESULT@@ ')) {
            console.error('No @@RESULT@@ line found');
            process.exit(1);
        }
        
        const lines = output.split('\n');
        let resultLine = '';
        
        // First, verify the RESULT line has exit_code 0
        for (const line of lines) {
            if (line.startsWith('@@RESULT@@ ')) {
                // The prefix "@@RESULT@@ " is 12 chars (indices 0-11), where index 11 = '{'
                // So substring(11) gives us '{"exit_code":...}'
                const payload = line.substring(11);  // Gives '{"exit_code":...}'
                try {
                    const res: any = JSON.parse(payload);
                    if (res.exit_code !== 0) {
                        console.error('Exit code is not 0:', res.exit_code);
                        process.exit(1);
                    }
                    resultLine = line;
                } catch (e: any) {
                    console.error('Failed to parse RESULT payload:', payload.substring(0, 50));
                    process.exit(1);
                }
            }
        }
        
        if (!resultLine) {
            console.error('No @@RESULT@@ line found');
            process.exit(1);
        }
        
        // Now check EV line for expected log event
        let logEventFound = false;
        for (const line of lines) {
            if (line.startsWith('@@EV@@ ')) {
                const payload = line.substring(7);  // Skip "@@EV@@ "
                try {
                    const ev: any = JSON.parse(payload);
                    if (ev.type === 'log' && ev.msg === 'hello' && ev.v === 1) {
                        logEventFound = true;
                        break;
                    }
                } catch (e: any) {
                    console.error('Failed to parse EV payload:', payload.substring(0, 50));
                    process.exit(1);
                }
            }
        }
        
        if (!logEventFound) {
            console.error('Log event with msg "hello" not found');
            process.exit(1);
        }
        
        console.log('PASS: gameapi smoke test successful');
        process.exit(0);
        
    } finally {
        // Cleanup
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {}
    }
}

main().catch(e => {
    console.error('Error:', e);
    process.exit(1);
});
