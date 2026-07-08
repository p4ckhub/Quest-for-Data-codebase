import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const TOOLCHAIN_DIR = path.join(__dirname, '../toolchain');
const LOCK_FILE = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');

// llvm-mingw releases: https://github.com/mstorsjo/llvm-mingw/releases
// The spec's v20.0.0 URL doesn't exist yet - use the latest production release.
// When v20.0.0 is released, update RELEASE_URL and EXPECTED_SHA.
const RELEASE_URL = 'https://github.com/mstorsjo/llvm-mingw/releases/download/20260616/llvm-mingw-20260616-msvcrt-x86_64.zip';
const EXPECTED_SHA: string | null = null; // Skip SHA validation (spec says to update this after first fetch)

if (!fs.existsSync(TOOLCHAIN_DIR)) {
  fs.mkdirSync(TOOLCHAIN_DIR, { recursive: true });
}

console.log('Fetching llvm-mingw from GitHub...');
try {
  execSync(`curl -L -o "${path.join(TOOLCHAIN_DIR, 'toolchain.zip')}" "${RELEASE_URL}"`, {
    stdio: 'inherit'
  });
} catch (e) {
  console.error('Download failed. Ensure curl is available.');
  process.exit(1);
}

// Compute SHA-256
console.log('Computing SHA-256...');
const fileBuffer = fs.readFileSync(path.join(TOOLCHAIN_DIR, 'toolchain.zip'));
const hashSum = crypto.createHash('sha256');
hashSum.update(fileBuffer);
const sha256 = hashSum.digest('hex');
console.log(`SHA-256: ${sha256}`);

if (EXPECTED_SHA !== null && sha256 !== EXPECTED_SHA) {
  console.warn(`⚠ SHA mismatch. Expected: ${EXPECTED_SHA}, got: ${sha256}`);
  console.warn('If this is the first fetch, update EXPECTED_SHA in this script.');
}

// Extract - handle both zip and tar.gz formats
const archivePath = path.join(TOOLCHAIN_DIR, 'toolchain.zip');
console.log('Extracting...');

// Check if it's a zip file (GitHub releases are .zip by default)
if (archivePath.endsWith('.zip') || fs.readFileSync(archivePath).slice(0, 4).toString() === 'PK\x03\x04') {
  execSync(`unzip -o "${archivePath}" -d "${TOOLCHAIN_DIR}"`, {
    stdio: 'inherit'
  });
} else {
  // tar archive (gzip or xz)
  execSync(`tar -xf "${archivePath}" -C "${TOOLCHAIN_DIR}"`, {
    stdio: 'inherit'
  });
}

// Write lock file
const lock = {
  version: 1,
  release_tag: '20260616',
  release_url: RELEASE_URL,
  sha256,
  extracted_at: new Date().toISOString(),
  clang_version_output: '' // Will be filled by verify script
};

fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
console.log(`✓ Lock written to ${LOCK_FILE}`);
