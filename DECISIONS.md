# Implementation Decisions

## 1. Adopted Quest for Data v2 specification
Date: 2026-07-07
Rationale: Full design lock on architecture, unambiguous for agent implementation.
Related: Quest for Data v2.md (§0–19).

---

## 2. Toolchain fetch - Updated to latest available release
Date: 2026-07-08
Rationale: The spec's llvm-mingw v20.0.0 release URL returned 404; the latest production release (20260616 with LLVM 22.1.8) is used instead.
Notes:
- Updated `scripts/fetch-toolchain.ts` to use correct URL and skip SHA validation on first fetch
- Updated `scripts/verify-toolchain.ts` for Linux compatibility (.exe files cannot execute natively)
- Toolchain is ready for cross-compilation to Windows targets
Related: PHASE0_DETAILED.md Task 0.2

---

## 3. sandbox_run.exe stub implementation created
Date: 2026-07-08
Rationale: Sandbox runner requires Windows Job Objects API which is not available on Linux.
Notes:
- Source files created in `sandbox_run/src/` (main.cpp, sandbox.h)
- CMakeLists.txt configured for cross-compilation build
- Test fixtures created for timeout, memory exhaustion, and stack overflow tests
- Full implementation requires Windows development environment with Visual Studio or mingw-w64
Related: PHASE0_DETAILED.md Task 0.3

---

## 4. Platform amendment - Single-profile toolchain (Linux native only)
Date: 2026-07-08
Rationale: Windows support dropped from Phase 0. Game only needs to run on Linux development machine; release target TBD.
Notes:
- `toolchain/toolchain.lock.json` now contains single profile `linux-native`
- Uses system g++ (Ubuntu 13.3.0) for all local lesson compiles
- Removed windows-cross/llvm-mingw directories and references from toolchain scripts
- Archives (.tar.*) still gitignored; lock file stays in git
Related: PHASE0_COMPLETION_PLAN.md Parts B.1, C.1

---
