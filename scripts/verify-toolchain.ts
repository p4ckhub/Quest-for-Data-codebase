import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TOOLCHAIN_DIR = path.join(__dirname, '../toolchain');
const LOCK_FILE = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');

interface Profile {
  type: string;
  compiler?: string;
  version?: string;
  path?: string;
  platform?: string;
}

interface LockFile {
  version: number;
  profiles: Record<string, Profile>;
  updated_at?: string;
}

// Load lock file
if (!fs.existsSync(LOCK_FILE)) {
  console.error('toolchain.lock.json not found. Run: npm run toolchain:fetch');
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as LockFile;
let allVerified = true;

console.log('Host architecture:', os.arch(), `(${process.platform})`);

// Process each profile
for (const [profileName, profile] of Object.entries(lock.profiles)) {
  if (!profile) continue;
  const typedProfile = profile as Profile;

  // A profile for another OS can't be verified on this host — and on a host
  // that happens to have the same compiler name on PATH it would fake-pass
  // (e.g. windows-native's "g++" resolving to Linux g++). The lock predates
  // the win32 profile, so platform uses "linux"/"win32" as process.platform does.
  if (typedProfile.platform && typedProfile.platform !== process.platform) {
    console.log(`SKIP ${profileName}: platform ${typedProfile.platform} (host is ${process.platform})`);
    continue;
  }

  if (typedProfile.type === 'system') {
    console.log(`Verifying ${profileName}...`);

    try {
      let compilerPath = typedProfile.path || typedProfile.compiler;
      if (!compilerPath) {
        console.error(`ERROR ${profileName}: no path or compiler specified`);
        allVerified = false;
        continue;
      }

      // Fetched profiles (e.g. windows-native) store a repo-relative path;
      // resolve it and demand the fetch has actually happened — verifying a
      // PATH fallback here would report the wrong compiler as "verified".
      if (typedProfile.path && !path.isAbsolute(typedProfile.path)) {
        compilerPath = path.join(TOOLCHAIN_DIR, '..', typedProfile.path);
        if (!fs.existsSync(compilerPath)) {
          console.error(`ERROR ${profileName}: ${compilerPath} not found - run: npm run toolchain:fetch`);
          allVerified = false;
          continue;
        }
      }

      const versionOutput = execSync(`"${compilerPath}" --version`, { encoding: 'utf-8' });
      const versionLine = versionOutput.trim().split('\n')[0];
      console.log(`OK ${profileName}: ${versionLine}`);

      // Record version in lock
      typedProfile.version = versionLine;

      // Compile+run hello world
      const testCppPath = path.join(TOOLCHAIN_DIR, `hello-${profileName}.cpp`);
      const testBinPath = path.join(TOOLCHAIN_DIR, `hello-${profileName}`);
      fs.writeFileSync(testCppPath, `#include <iostream>\nint main() { std::cout << "Hello from ${profileName}" << std::endl; return 0; }`);

      try {
        execSync(`"${compilerPath}" -std=c++17 -o "${testBinPath}" "${testCppPath}"`, { stdio: 'pipe' });
        const runResult = execSync(testBinPath, { encoding: 'utf-8', timeout: 5000 });
        console.log(`OK Compiled and ran hello from ${profileName}`);
      } catch (e) {
        console.error(`ERROR Failed to compile/run hello-${profileName}.cpp`);
        allVerified = false;
      }

      // Clean up (MinGW g++ appends .exe when -o has no extension)
      if (fs.existsSync(testCppPath)) fs.unlinkSync(testCppPath);
      if (fs.existsSync(testBinPath)) fs.unlinkSync(testBinPath);
      if (fs.existsSync(testBinPath + '.exe')) fs.unlinkSync(testBinPath + '.exe');
    } catch (e: any) {
      console.error(`ERROR Failed to run ${typedProfile.compiler} --version`);
      allVerified = false;
    }
  } else {
    console.warn(`WARNING ${profileName}: unknown type "${typedProfile.type}" - skipping verification`);
  }
}

// Update lock file timestamp and version info
lock.updated_at = new Date().toISOString();
fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));

console.log('\n--- Verification Summary ---');
if (allVerified) {
  console.log('OK All toolchain profiles verified successfully');
  process.exit(0);
} else {
  console.error('ERROR Some toolchain profiles failed verification');
  process.exit(1);
}
