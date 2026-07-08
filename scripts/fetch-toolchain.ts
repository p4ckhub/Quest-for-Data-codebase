import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const TOOLCHAIN_DIR = path.join(__dirname, '../toolchain');
const LOCK_FILE = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');

interface Profile {
  type: string;
  source?: string;
  extracted_dir?: string;
  sha256?: string;
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

// Ensure toolchain directory exists
if (!fs.existsSync(TOOLCHAIN_DIR)) {
  fs.mkdirSync(TOOLCHAIN_DIR, { recursive: true });
}

// Process each profile that requires fetching (tarball type)
for (const [profileName, profile] of Object.entries(lock.profiles) as [string, Profile][]) {
  if (profile.type !== 'tarball') {
    console.log(`Profile "${profileName}": system compiler - no fetch needed`);
    continue;
  }

  const archivePath = path.join(TOOLCHAIN_DIR, `${profileName}.tar.xz`);
  
  // Check if already extracted
  let extractedDir: string | undefined;
  if (profile.extracted_dir && fs.existsSync(path.join(TOOLCHAIN_DIR, profile.extracted_dir))) {
    extractedDir = profile.extracted_dir;
  } else {
    // Find existing extracted directory
    const dirs = fs.readdirSync(TOOLCHAIN_DIR).filter(d => d.includes('llvm-mingw') && !d.endsWith('.tar.xz'));
    if (dirs.length > 0) {
      extractedDir = dirs[0];
    }
  }

  if (extractedDir && fs.existsSync(path.join(TOOLCHAIN_DIR, extractedDir))) {
    console.log(`Profile "${profileName}": already extracted at ${path.join(TOOLCHAIN_DIR, extractedDir)}`);
    profile.extracted_dir = extractedDir;
    continue;
  }

  if (!profile.source) {
    console.error(`Profile "${profileName}": missing source URL`);
    process.exit(1);
  }

  console.log(`Fetching ${profileName} from: ${profile.source}`);

  try {
    execSync(`curl -L -o "${archivePath}" "${profile.source}"`, {
      stdio: 'inherit'
    });
  } catch (e) {
    console.error('Download failed. Ensure curl is available and the URL is correct.');
    process.exit(1);
  }

  // Compute SHA-256
  const fileBuffer = fs.readFileSync(archivePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  const sha256 = hashSum.digest('hex');

  console.log(`SHA-256: ${sha256}`);

  // Update lock with SHA
  lock.profiles[profileName].sha256 = sha256;
  
  // Extract
  console.log('Extracting...');
  try {
    execSync(`tar -xf "${archivePath}" -C "${TOOLCHAIN_DIR}"`, {
      stdio: 'inherit'
    });
    
    // Find newly extracted directory
    const newDirs = fs.readdirSync(TOOLCHAIN_DIR).filter(d => d.includes('llvm-mingw') && !d.endsWith('.tar.xz'));
    if (newDirs.length > 0) {
      lock.profiles[profileName].extracted_dir = newDirs[0];
    }
    
    console.log(`Profile "${profileName}": extracted successfully`);
  } catch (e: any) {
    console.error(`Extraction failed: ${e.message || e}`);
    process.exit(1);
  }
}

lock.updated_at = new Date().toISOString();
fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
console.log('OK: Toolchain fetch complete');
