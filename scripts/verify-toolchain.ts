import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TOOLCHAIN_DIR = path.join(__dirname, '../toolchain');
const LOCK_FILE = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');

// Type definitions for profiles
interface SystemProfile {
  type: 'system';
  compiler: string;
  version: string;
  path: string;
  description?: string;
}

// Load lock file
if (!fs.existsSync(LOCK_FILE)) {
  console.error('toolchain.lock.json not found. Run: npm run toolchain:fetch');
  process.exit(1);
}

const lockContent = fs.readFileSync(LOCK_FILE, 'utf-8');
const lock = JSON.parse(lockContent);
let allVerified = true;

console.log(`Verify toolchain profiles: ${Object.keys(lock.profiles).join(', ')}`);

// Helper to run clang++ --version and capture output
function verifyClangVersion(clangPath: string, profileName: string): string | null {
  try {
    const output = execSync(`${clangPath} --version`, { encoding: 'utf-8', timeout: 10000 });
    return output.trim();
  } catch (e) {
    console.error(`Failed to run clang++ --version for ${profileName}`);
    if (e instanceof Error && 'stderr' in e && typeof e.stderr === 'string') {
      console.error(e.stderr);
    }
    return null;
  }
}

// Helper to compile and run a test program
function compileAndRun(sourcePath: string, outputPath: string, compiler: string): boolean {
  try {
    execSync(`${compiler} -o "${outputPath}" "${sourcePath}"`, { stdio: 'inherit' });
    const result = execSync(outputPath, { encoding: 'utf-8', timeout: 5000 });
    console.log(`OK ${path.basename(sourcePath)} compiled and ran successfully`);
    return true;
  } catch (e) {
    console.error(`Failed to compile/run ${sourcePath}`);
    if (e instanceof Error && 'stderr' in e && typeof e.stderr === 'string') {
      console.error(e.stderr);
    }
    return false;
  }
}

// Helper to check file type
function checkFileFormat(filePath: string, expectedType: string): boolean {
  try {
    const output = execSync(`file "${filePath}"`, { encoding: 'utf-8' });
    if (output.includes(expectedType)) {
      console.log(`OK ${path.basename(filePath)} is ${expectedType}`);
      return true;
    } else {
      console.error(`Expected ${expectedType}, got: ${output.trim()}`);
      return false;
    }
  } catch (e) {
    console.error(`Could not determine file type for ${filePath}`);
    return false;
  }
}

// Process each profile
for (const [profileName, profile] of Object.entries(lock.profiles)) {
  console.log(`\n--- Verifying profile: ${profileName} ---`);

  const typedProfile = profile as any;

  if (typedProfile.type === 'system') {
    // System compiler - verify it's available and get version
    const versionOutput = verifyClangVersion(typedProfile.path, profileName);
    
    if (versionOutput) {
      console.log(`OK ${profileName}: ${typedProfile.compiler} ${typedProfile.version}`);
      console.log(`  Version output: ${versionOutput.split('\n')[0]}`);
      
      // Update lock with actual version
      lock.profiles[profileName].version = typedProfile.version;
      fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));
    } else {
      allVerified = false;
    }
    
    // Compile+run hello world
    const testCppPath = path.join(TOOLCHAIN_DIR, 'hello-native.cpp');
    const testBinPath = path.join(TOOLCHAIN_DIR, 'hello-native');
    fs.writeFileSync(testCppPath, '#include <iostream>\nint main() { std::cout << "Hello from ' + profileName + '" << std::endl; return 0; }');
    
    if (!compileAndRun(testCppPath, testBinPath, typedProfile.path)) {
      allVerified = false;
    }
    
    // Clean up
    if (fs.existsSync(testCppPath)) fs.unlinkSync(testCppPath);
    if (fs.existsSync(testBinPath)) fs.unlinkSync(testBinPath);

  } else if (typedProfile.type === 'tarball') {
    const extractedDir = typedProfile.extracted_dir ? path.join(TOOLCHAIN_DIR, typedProfile.extracted_dir) : TOOLCHAIN_DIR;
    // clang_pp_path should be the relative path from extracted_dir (e.g., "bin/x86_64-w64-mingw32-clang++")
    const clangBinaryName = typedProfile.clang_pp_path || typedProfile.clangpp_path;
    if (!clangBinaryName) {
      console.error(`ERROR ${profileName}: clangpp_path is not defined`);
      allVerified = false;
      continue;
    }
    // The binary is located at: extracted_dir/bin/clangBinaryName
    const clangPath = path.join(extractedDir, 'bin', clangBinaryName);
    
    // Check if extracted
    if (!fs.existsSync(extractedDir)) {
      console.error(`ERROR ${profileName}: extracted directory not found at ${extractedDir}`);
      allVerified = false;
      continue;
    }
    
    if (!fs.existsSync(clangPath)) {
      console.error(`ERROR ${profileName}: clang++ not found at ${clangPath}`);
      allVerified = false;
      continue;
    }
    
    // Verify version - for Windows PE binaries on Linux, we check file type instead of executing
    const fileTypeOutput = execSync(`file "${clangPath}"`, { encoding: 'utf-8' });
    if (fileTypeOutput.includes('PE32') || fileTypeOutput.includes('PE64')) {
      console.log(`OK ${profileName}: clang++ is a Windows PE binary (${fileTypeOutput.trim()})`);
      
      // Cross-compile hello world to Windows PE
      const testCppPath = path.join(TOOLCHAIN_DIR, 'hello-cross.cpp');
      const testBinPath = path.join(TOOLCHAIN_DIR, 'hello-cross.exe');
      fs.writeFileSync(testCppPath, '#include <iostream>\nint main() { std::cout << "Hello from ' + profileName + '" << std::endl; return 0; }');
      
      if (compileAndRun(testCppPath, testBinPath, clangPath)) {
        // Verify it's a Windows PE binary
        checkFileFormat(testBinPath, 'PE32');
        
        // Clean up cross-compiled binary
        if (fs.existsSync(testBinPath)) fs.unlinkSync(testBinPath);
      } else {
        allVerified = false;
      }
      
      if (fs.existsSync(testCppPath)) fs.unlinkSync(testCppPath);
    } else {
      allVerified = false;
    }
  }
}

// Clean up any stale archives
const archiveGlob = ['linux-native.tar.xz', 'windows-cross.tar.xz'];
for (const archive of archiveGlob) {
  const archivePath = path.join(TOOLCHAIN_DIR, archive);
  if (fs.existsSync(archivePath)) {
    console.log(`Removing archive: ${archive}`);
    fs.unlinkSync(archivePath);
  }
}

console.log('\n--- Verification Summary ---');
if (allVerified) {
  console.log('OK All toolchain profiles verified successfully');
  process.exit(0);
} else {
  console.error('ERROR Some toolchain profiles failed verification');
  process.exit(1);
}
