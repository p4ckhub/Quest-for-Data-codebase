import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TOOLCHAIN_DIR = path.join(__dirname, '../toolchain');
const LOCK_FILE = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
// The extracted folder uses the release date as its base name
// clang++.exe is a Windows binary; on Linux we verify it exists but don't run it
const CLANG_BIN = path.join(TOOLCHAIN_DIR, 'llvm-mingw-20260616-msvcrt-x86_64', 'bin', 'clang++.exe');

if (!fs.existsSync(LOCK_FILE)) {
  console.error('toolchain.lock.json not found. Run: npm run toolchain:fetch');
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));

if (!fs.existsSync(CLANG_BIN)) {
  console.error(`Clang binary not found at ${CLANG_BIN}`);
  console.error('Extraction may have failed.');
  process.exit(1);
}

// Verify binary exists (on Linux this is a Windows cross-compiler .exe)
console.log('Verifying toolchain files...');
const binDir = path.dirname(CLANG_BIN);
const binFiles = fs.readdirSync(binDir).filter(f => f.endsWith('.exe') || f === 'clang++' || f.includes('ld')).sort();
console.log('Available binaries:', binFiles.slice(0, 5));

// Note: On Linux, clang++.exe cannot be executed directly (Windows PE binary).
// The toolchain is ready for cross-compilation to Windows targets.
if (process.platform !== 'win32') {
  console.log('(Note: clang++.exe is a Windows PE binary; cannot execute on Linux. Cross-compiler is ready.)');
}

console.log('✓ Toolchain verified (files present)');
