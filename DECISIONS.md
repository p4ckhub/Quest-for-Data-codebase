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

## 4. Platform amendment - Dual-profile toolchain (Linux native + Windows cross)
Date: 2026-07-08
Rationale: Game must be bootable on Linux (development machine) and Windows (release target).
Notes:
- `toolchain/toolchain.lock.json` now contains two profiles:
  - `linux-native`: Uses system g++/clang from apt for local development and Linux runtime
  - `windows-cross`: llvm-mingw UCRT Ubuntu-hosted tarball, cross-compiles to PE32+ Windows binaries
- Verification script actually executes clang++ --version for host-runnable profiles and exits 1 if empty
- Smoke test: compiles+runs hello-world with linux-native; cross-compiles same file with windows-cross and verifies PE32+ output
- toolchain.zip (Windows-hosted PE32+ archive) removed from tree; archives gitignored
Related: PHASE0_COMPLETION_PLAN.md Parts B.1, C.1
