import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TOOLCHAIN_DIR = path.join(__dirname, '../toolchain');
const LOCK_FILE = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');

interface Profile {
  type: string;
  compiler?: string;
  version?: string;
  path?: string;
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

console.log(`Fetch toolchain profiles: ${Object.keys(lock.profiles).join(', ')}`);

// Process each profile
for (const [profileName, profile] of Object.entries(lock.profiles)) {
  if (!profile) continue;
  const typedProfile = profile as Profile;

  if (typedProfile.type === 'system') {
    console.log(`Profile "${profileName}": system compiler - no fetch needed`);
    continue;
  }

  console.warn(`Profile "${profileName}": unknown type "${typedProfile.type}" - skipping`);
}

lock.updated_at = new Date().toISOString();
fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
console.log('OK: Toolchain fetch complete');
