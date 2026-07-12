import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const PROJECT_ROOT = path.join(__dirname, '..');
const TOOLCHAIN_DIR = path.join(PROJECT_ROOT, 'toolchain');
const LOCK_FILE = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');

interface FetchSpec {
  url: string;
  sha256: string;
  // Directory (repo-relative) the archive is extracted into. The archive's own
  // top-level directory provides the final layout (e.g. mingw64/).
  extract_to: string;
}

interface Profile {
  type: string;
  compiler?: string;
  version?: string;
  path?: string;
  platform?: string;
  fetch?: FetchSpec;
}

interface LockFile {
  version: number;
  profiles: Record<string, Profile>;
  updated_at?: string;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
}

async function fetchProfile(profileName: string, spec: FetchSpec): Promise<void> {
  const extractDir = path.join(PROJECT_ROOT, spec.extract_to);
  const archivePath = path.join(TOOLCHAIN_DIR, `${profileName}-download${path.extname(spec.url)}`);

  console.log(`Profile "${profileName}": downloading ${spec.url}`);
  console.log('(a few hundred MB - this is the one-time compiler download)');
  await download(spec.url, archivePath);

  const actual = await sha256File(archivePath);
  if (actual !== spec.sha256) {
    fs.unlinkSync(archivePath);
    throw new Error(
      `Checksum mismatch for ${profileName}: expected ${spec.sha256}, got ${actual} - refusing to extract`);
  }
  console.log(`Profile "${profileName}": checksum OK`);

  // bsdtar ships with Windows 10 1803+ and reads zip archives; no npm dep needed.
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xf', archivePath, '-C', extractDir], { stdio: 'inherit' });
  fs.unlinkSync(archivePath);
  console.log(`Profile "${profileName}": extracted to ${extractDir}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(LOCK_FILE)) {
    console.error('toolchain.lock.json not found. Run: npm run toolchain:fetch');
    process.exit(1);
  }

  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as LockFile;

  console.log(`Fetch toolchain profiles: ${Object.keys(lock.profiles).join(', ')}`);

  for (const [profileName, profile] of Object.entries(lock.profiles)) {
    if (!profile) continue;
    const typedProfile = profile as Profile;

    // Another OS's toolchain is dead weight on this host (and its post-fetch
    // verification couldn't run anyway - same skip rule as verify-toolchain.ts).
    if (typedProfile.platform && typedProfile.platform !== process.platform) {
      console.log(`SKIP ${profileName}: platform ${typedProfile.platform} (host is ${process.platform})`);
      continue;
    }

    if (typedProfile.fetch) {
      // path is repo-relative for fetched profiles, absolute for true system ones.
      const compilerPath = typedProfile.path && !path.isAbsolute(typedProfile.path)
        ? path.join(PROJECT_ROOT, typedProfile.path)
        : typedProfile.path;
      if (compilerPath && fs.existsSync(compilerPath)) {
        console.log(`Profile "${profileName}": already present at ${compilerPath} - no fetch needed`);
        continue;
      }
      await fetchProfile(profileName, typedProfile.fetch);
      if (compilerPath && !fs.existsSync(compilerPath)) {
        throw new Error(
          `Profile "${profileName}": extraction finished but ${compilerPath} does not exist - archive layout changed?`);
      }
      continue;
    }

    if (typedProfile.type === 'system') {
      console.log(`Profile "${profileName}": system compiler - no fetch needed`);
      continue;
    }

    console.warn(`Profile "${profileName}": unknown type "${typedProfile.type}" - skipping`);
  }

  lock.updated_at = new Date().toISOString();
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
  console.log('OK: Toolchain fetch complete');
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
