# WINDOWS PHASE — Bring-up of a Windows Build/Play Target

**Status: IN PROGRESS.** Dev machine is ARM64 Ubuntu Linux with no physical Windows box. **Verification environment is decided (2026-07-12): GitHub Actions `windows-latest` runner** — see WP-CI below and Open Question 1 (resolved). Local cross-compilation via `x86_64-w64-mingw32-g++` (aarch64-host → x86_64-Windows-target) is used for fast compile-checking only; all behavioral verification (Job Objects, structured exceptions, pipe semantics) runs on real Windows in CI. Wine is deliberately **not** used on this machine — the host is aarch64, so running the x86_64 `.exe` would require Wine *plus* an x86 emulation layer (Hangover/FEX), stacking two fidelity question marks on exactly the OS semantics this phase needs to verify. Bryson does the WP-7 manual play session on a physical Windows machine later.

Quest for Data compiles and sandbox-executes student-submitted C++. The entire game is platform-agnostic TypeScript/React/Electron except for one native component: `sandbox_run`, a small C++ CLI that runs the compiled student program under OS-level resource limits (wall clock, CPU time, memory, output size) and reports the outcome as a fixed JSON contract. That component's Windows implementation is currently a 14-line non-functional stub. Everything else — runner, content, UI — already builds on any platform in principle, but has a handful of Linux-only assumptions (hardcoded binary names without `.exe`, shell-string `execSync` invocations, a Linux-only toolchain profile) that will break the moment `sandbox_run.exe`, `toolchain/bin/sandbox_run.exe`, and a Windows g++ exist.

This phase is ordered so each task is independently testable, and so the **earliest deliverable is "compiles and plays via `npx electron .` on Windows from source"** — a real distributable installer (electron-builder packaging) is deliberately pushed to the last, optional task.

## House rules for this phase

1. **Behavioral contract is non-negotiable.** `sandbox_win.cpp` must satisfy the exact `@@RESULT@@` JSON line format, key order, `killed_by` vocabulary, and always-exit-0 contract that `sandbox_posix.cpp` already satisfies (see `sandbox_run/src/sandbox.h` and `runner/src/validator.ts`'s `EXIT_STATUS_ROWS`). Anything the rest of the app depends on as a semantic string (`"sigsegv"`, `"memory"`, `"wall_timeout"`, `"cpu_timeout"`, `"output_cap"`) must be produced verbatim even though the underlying OS mechanism differs.
2. **Prefer polling watchdog over IOCP.** `sandbox_posix.cpp` already uses a single watchdog thread that wakes every ~10ms and a `poll()`-driven read loop. Mirror that shape on Windows (`WaitForSingleObject` timeout + `PeekNamedPipe`-gated `ReadFile` + periodic `QueryInformationJobObject` for CPU accounting) rather than introducing an I/O completion port. It's simpler to reason about without a physical Windows box, and keeps the two implementations structurally comparable for future maintenance.
3. **No PCH work.** `USE_PCH` is `const false` in the live path (`runner/src/index.ts:40`); don't port it.
4. **Shell-string `execSync` → argument-array `execFileSync`/`spawnSync` conversions are cross-platform hygiene, not Windows-only code.** Do this once, correctly, for both platforms — don't special-case Windows quoting inside a string builder.
5. **MinGW-w64 g++ is the recommended Windows compiler, not MSVC/clang-cl.** Justification is in WP-5; this is treated as decided, not open, because of a concrete blocking dependency (`runner/src/error_table.ts` pattern-matches GCC diagnostic text verbatim — MSVC's error format would silently break every in-game compile-error hint).

---

## Task list

| Task | What | Depends on |
|---|---|---|
| WP-0 | `sandbox_win.cpp`: process spawn via Job Object + pipe-based stdout/stderr capture + `@@RESULT@@` contract, no resource limits yet | — |
| WP-1 | `sandbox_win.cpp`: wall/CPU/memory/output-cap enforcement + exception→`killed_by` mapping (the `"sigsegv"` string requirement) | WP-0 |
| WP-2 | `sandbox_win.cpp`: stdin piping via `--stdin-file`, full CLI flag parity with `sandbox_posix.cpp` | WP-0 |
| WP-3 | Build automation: CMake Windows branch hardening (static runtime linking), npm script(s) to drive the build per platform | WP-1, WP-2 |
| WP-4 | Windows `sandbox_run` test suite: adapt/wire staged fixtures into `tests/sandbox.test.ts` (or a parallel Windows suite), reconcile fixture semantics with the POSIX suite's assertions | WP-3 |
| WP-CI | GitHub Actions `windows-latest` workflow: build `sandbox_run.exe` with MinGW, run the WP-4 suite — the phase's behavioral-verification environment | WP-0 (useful from first commit; full value at WP-4) |
| WP-5 | Toolchain: MinGW-w64 sourcing/bundling decision, `windows-native` lock profile, platform-aware profile selection in `getCompilerPath()` (both copies) | — |
| WP-6 | Runner path-safety: `findProjectRoot()` `.exe` handling (`index.ts` + `combat.ts`), `execSync`→`execFileSync`/argv-array conversion for compile and sandbox invocation call sites | WP-5 |
| WP-7 | End-to-end verification: `lessons:validate`, full `vitest`, `e2e-drive` smoke, manual `npx electron .` play session — the actual "plays on Windows" milestone | WP-4, WP-6 |
| WP-8 *(optional, later)* | electron-builder packaging: minimal `"build"` config, Windows installer target, packaging npm script | WP-7 |

---

## WP-0 — `sandbox_win.cpp`: process spawn + pipe capture, no limits yet

**Goal:** a Windows binary that can run a trivial child program, capture its stdout, and print a correctly-shaped `@@RESULT@@` line, with no timeout/memory/output-cap enforcement yet. This gets the plumbing right (the part most prone to classic Windows pipe-handle bugs) before layering resource limits on top in WP-1.

**Files touched:**
- `sandbox_run/src/sandbox_win.cpp` — full rewrite (currently 14 lines, doesn't compile: uses `std::cout` without `#include <iostream>`).

**What changes:**
- Include `sandbox.h` for `RunConfig`/`RunResult`, plus `<windows.h>`, `<iostream>`, `<sstream>`, `<string>`, `<vector>`.
- Create two anonymous pipes via `CreatePipe`: one for the child's stdout (read end kept by parent, write end given to child), one for stderr (same shape). **Immediately after each `CreatePipe`, call `SetHandleInformation(<the end the parent keeps>, HANDLE_FLAG_INHERIT, 0)`.** This is the single most common Windows pipe-redirection bug: `CreateProcess` with `bInheritHandles=TRUE` inherits *every* inheritable handle open in the parent, not just the ones named in `STARTUPINFO`. If the parent's own read-end handle stays inheritable, the child gets an extra copy of it; then when the parent closes its write-end copy on exit, the pipe doesn't see EOF because the child (or the job) still holds a handle to the *other* end, and the parent's `ReadFile` loop hangs forever. Symmetric rule for the stdin pipe: keep the parent's write-end handle inheritable=false too.
- Build `STARTUPINFOA` with `dwFlags = STARTF_USESTDHANDLES`, `hStdOutput`/`hStdError` = the child-side pipe write ends, `hStdInput` = the child-side stdin pipe read end (or `GetStdHandle(STD_INPUT_HANDLE)`/`NUL` if no `--stdin-file`).
- Build the command line by quoting `config.exe` and each `config.args[]` element per Windows `CommandLineToArgvW` conventions (backslash/quote escaping is genuinely different from POSIX `execvp`'s `argv[]` — this is real, unavoidable Windows-specific string work, unlike the runner-side `execSync`→`execFileSync` conversions in WP-6 which sidestep quoting entirely by using argv arrays already; `CreateProcess` only accepts one command-line string, so a small `quote_arg()` helper implementing the documented MSVCRT quoting rules is required here).
- `CreateProcessA(..., CREATE_SUSPENDED | CREATE_NO_WINDOW, ...)` — suspended so the process can be attached to a Job Object *before* it runs (avoids a TOCTOU window where the child could spawn grandchildren, or even exit, before limits are attached). `CREATE_NO_WINDOW` avoids a console flash when sandbox_run is invoked from Electron's main process.
- `CreateJobObjectA(nullptr, nullptr)`, `AssignProcessToJobObject(hJob, pi.hProcess)`, then `ResumeThread(pi.hThread)`.
- Close the child-side pipe handles in the parent immediately after `CreateProcess` returns (parent doesn't need them, and holding them open contributes to the same EOF-hang bug class above).
- If `!config.stdin_file.empty()`, write the file's contents to the stdin pipe's write end, then close it (same ordering as `sandbox_posix.cpp` — write then close, before entering the read loop).
- Read loop: use `WaitForSingleObject(pi.hProcess, ...)` combined with a `PeekNamedPipe`-gated `ReadFile` on the stdout/stderr read ends, capturing bytes into `std::ostringstream` buffers (mirrors the `poll()`+`read()` shape in `sandbox_posix.cpp` lines 174–230 closely enough that a future maintainer reading both files side by side can follow the parallel). This full loop (with cap/timeout logic) belongs to WP-1; for WP-0, a minimal blocking version that reads until EOF and then waits for exit is enough to validate the plumbing.
- `GetExitCodeProcess(pi.hProcess, &exitCode)` after the process is confirmed dead; write `result.exit_code = static_cast<int>(exitCode)` (Windows exit codes for structured exceptions are large unsigned 32-bit NTSTATUS values like `0xC0000005` — cast semantics matter here; `runner/src/validator.ts`'s `EXIT_STATUS_ROWS` already has literal decimal comparisons against `3221225725`/`3221225477`, i.e. the *unsigned* 32-bit values, so do not sign-extend/truncate through a narrower type on the way out).
- Emit stdout content, then the `@@RESULT@@ {...}` line with the exact key order (`exit_code`, `wall_ms`, `cpu_ms`, `killed_by`) via `std::cout`, matching `sandbox_posix.cpp` lines 296–314 byte-for-byte in shape.
- `main()`/`parse_args()` — port verbatim from `sandbox_posix.cpp` lines 319–400 (this logic is already 100% portable C++, no POSIX calls) — except the temp-`cwd` creation, which uses `mkdtemp` + a hardcoded `/tmp/sandbox_XXXXXX` template; replace with `GetTempPathA` + a `GetTempFileNameA`-style unique directory name, and replace the `rm -rf` cleanup shell-out with a recursive `RemoveDirectoryA`/`DeleteFileA` walk (or, simpler and adequate for this program's lifetime, leave temp-dir cleanup as an `if (!tmp_cwd.empty()) delete_recursive(tmp_cwd);` helper — a handful of lines, no shell dependency needed on either platform, which also removes the mildly sketchy `system("rm -rf ...")` call the POSIX version does today).

**How to verify (WP-0 alone, no limits):** compile a trivial `int main(){ std::cout << "hi\n"; return 0; }` with the eventual MinGW compiler (WP-5) and run `sandbox_run.exe -- hello.exe`; confirm stdout is `hi` followed by `@@RESULT@@ {"exit_code":0,"wall_ms":<n>,"cpu_ms":<n>,"killed_by":null}`. Since there's no Windows box confirmed available yet, this step is blocked on the Open Questions below — flag it, don't silently skip verification.

---

## WP-1 — Resource limit enforcement + exception mapping

**Goal:** wall-clock timeout, CPU-time timeout, memory cap, and stdout cap all produce the correct `killed_by` string; stack overflow / access violation produce `"sigsegv"`.

**Files touched:**
- `sandbox_run/src/sandbox_win.cpp`

**What changes:**
- **Memory cap:** `SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli))` with `jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and `jeli.ProcessMemoryLimit = config.mem_mb * 1024 * 1024`, set **before** `ResumeThread` (limits must be attached while still suspended). Important nuance carried over from the POSIX design: `JOB_OBJECT_LIMIT_PROCESS_MEMORY` does **not** itself terminate the process — like `RLIMIT_AS` on Linux, it makes allocation calls beyond the cap simply *fail* (`VirtualAlloc`/`HeapAlloc`/`new` return null / throw). The child's C++ runtime then hits an uncaught `std::bad_alloc`, calls `std::terminate()` → `abort()`, and (under MinGW-w64's libstdc++, same runtime family as Linux) prints `terminate called after throwing an instance of 'std::bad_alloc' ... what(): std::bad_alloc` to **stderr** before exiting (typically exit code 3). **This means the detection mechanism must mirror `sandbox_posix.cpp` line 284 exactly: capture stderr and substring-match `"bad_alloc"` to set `killed_by = "memory"`.** Do not assume Windows will "kill" the process on OOM the way a completion-port `JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT` notification suggests it might — that message fires on notification, but nothing auto-terminates the process from it, so relying on it without a manual `TerminateJobObject` call adds real complexity for no correctness benefit over the stderr heuristic. If bring-up testing later shows the stderr heuristic under-fires (e.g. some allocation site swallows the exception, or the child hangs instead of crashing), fall back to the CPU/wall-clock watchdog also polling `QueryInformationJobObject(JobObjectExtendedLimitInformation)`'s `PeakProcessMemoryUsed` each tick and self-terminating past a small margin over `mem_mb` as a backstop.
- **Wall-clock timeout:** single watchdog thread, `WaitForSingleObject(pi.hProcess, remaining_ms)` in a loop (or one shot with the full `wall_ms` budget) — on `WAIT_TIMEOUT`, call `TerminateJobObject(hJob, 1)` (kills the whole job, i.e. the child and any children it spawned — an improvement over the POSIX version's plain `kill(pid, SIGKILL)`, which only kills the immediate child) and set `killed_by = "wall_timeout"`.
- **CPU-time timeout:** Windows Job Objects have no auto-kill-on-CPU-time primitive equivalent to `RLIMIT_CPU`'s `SIGXCPU`. Implement by polling `QueryInformationJobObject(hJob, JobObjectBasicAccountingInformation, &info, ...)` inside the same watchdog loop (every ~10ms, matching the POSIX code's `std::this_thread::sleep_for(10ms)` cadence) and summing `info.TotalUserTime + info.TotalKernelTime` (100ns units, divide by 10000 for ms); once it exceeds `config.cpu_ms`, `TerminateJobObject` and set `killed_by = "cpu_timeout"`. Job accounting sums all processes ever assigned to the job, which is the correct semantic parity with the POSIX code's `getrusage(RUSAGE_CHILDREN, ...)`.
- **Output cap:** in the same watchdog/read loop, use `PeekNamedPipe` to check bytes-available on the stdout pipe without blocking (Windows anonymous pipes don't support `select`/non-blocking `ReadFile` the way POSIX `fcntl(O_NONBLOCK)` does — `PeekNamedPipe` + conditional `ReadFile` is the standard substitute), accumulate into the stdout buffer, and once `stdout_cap_kb * 1024` bytes are exceeded, `TerminateJobObject` and set `killed_by = "output_cap"` — same shape as `sandbox_posix.cpp` lines 203–216.
- **Exception → `"sigsegv"` mapping:** after the process exits (not killed by the watchdog), inspect `GetExitCodeProcess()`. If the value equals `STATUS_ACCESS_VIOLATION` (`0xC0000005`) or `STATUS_STACK_OVERFLOW` (`0xC00000FD`), set `result.killed_by = "sigsegv"` **in addition to** passing the raw exit code through unchanged. This double-covers `runner/src/validator.ts`'s `EXIT_STATUS_ROWS.stack_overflow`/`access_violation` rows, which already special-case those exact decimal literals (`3221225725`, `3221225477`) as a fallback *and* accept `killed_by === "sigsegv"` — so the Windows implementation doesn't strictly have to know about the `"sigsegv"` string to pass those specific rows via raw exit code, but other call sites (`runner/src/index.ts`'s `mapOutcome()`, `scripts/lesson-runner.js`'s `mapOutcome()`) branch on `killed_by === 'memory'`/other string values for player-facing error messages, not on raw exit codes — so setting the string is required for a correct in-game message, not just to satisfy the validator.
- **Windows threading note (avoid a hidden runtime-DLL dependency):** implement the watchdog with native `CreateThread`/`_beginthreadex`, not `std::thread`. MinGW-w64's `std::thread` requires `libwinpthread-1.dll` on some MinGW distributions (the "posix" threading model) unless statically linked; using the raw Win32 thread API removes that dependency question entirely rather than needing to get the static-linking flags exactly right (WP-3 still recommends static-linking `libgcc`/`libstdc++` regardless, for portability of the executable to a bare Windows machine, but removing the threading-model variable entirely is cheap insurance).

**How to verify:** once WP-3/WP-4 have a runnable binary and test harness, the four staged-fixture-derived tests below (WP-4) exercise exactly these four code paths.

---

## WP-2 — stdin piping + CLI flag parity

**Goal:** `--stdin-file <path>` reaches the child's real stdin; all seven flags from the POSIX CLI (`--wall-ms --cpu-ms --mem-mb --stdout-cap-kb --stdin-file --cwd --`) parse identically.

**Files touched:**
- `sandbox_run/src/sandbox_win.cpp`

**What changes:**
- `parse_args()` ports verbatim (pure C++ string/vector logic, no POSIX calls) — already covered in WP-0's port of `main()`/`parse_args()`.
- Stdin pipe wiring: covered in WP-0 (the `hStdInput` pipe + write-then-close sequencing). This task is really "confirm it end-to-end" once WP-0/WP-1 land, plus handle the *no* `--stdin-file` case correctly — POSIX version leaves the child's stdin as a pipe with the write end immediately closed (so `cin` reads see immediate EOF, not the parent's real stdin); Windows should do the same rather than inheriting `GetStdHandle(STD_INPUT_HANDLE)`, to avoid the sandboxed child ever reading from whatever is attached to the Electron process's own stdin.

**How to verify:** the "should pipe stdin to process" test in WP-4's suite.

---

## WP-3 — Build automation

**Goal:** a reproducible way to build `sandbox_run.exe` and land it at `toolchain/bin/sandbox_run.exe`, and (separately) a documented/scripted way to do it without a physical Windows box if possible.

**Files touched:**
- `sandbox_run/CMakeLists.txt`
- `package.json` (new npm scripts)

**What changes:**
- `CMakeLists.txt`'s `elseif(WIN32)` branch: add static-runtime linking so the produced `.exe` doesn't depend on `libgcc_s_seh-1.dll`/`libstdc++-6.dll`/`libwinpthread-1.dll` being present on the target machine (which they won't be on a bare Windows install — MinGW-w64 dynamically links these by default):
  ```cmake
  elseif(WIN32)
      add_executable(sandbox_run src/sandbox_win.cpp)
      target_link_options(sandbox_run PRIVATE -static -static-libgcc -static-libstdc++)
  ```
  (No `target_link_libraries` addition needed — Job Objects/process/pipe APIs are all in `kernel32.lib`, which MinGW links by default.)
- `RUNTIME_OUTPUT_DIRECTORY` is already `${CMAKE_BINARY_DIR}/../toolchain/bin` and platform-agnostic (CMake appends `.exe` automatically on Windows) — no change needed there; the gap is entirely on the *consumer* side (WP-6).
- `package.json`: add npm scripts to drive the build rather than relying on a manually-built-and-committed binary as today:
  - `"sandbox:build": "cmake -S sandbox_run -B sandbox_run/build && cmake --build sandbox_run/build --config Release"` — works unmodified on both platforms since CMake picks the right generator/compiler per host by default. On a Windows dev box with MinGW on `PATH`, add `-G "MinGW Makefiles"` if Visual Studio's generator gets auto-selected instead (Visual Studio's generator would invoke MSVC, not MinGW — undesirable given the GCC-diagnostic-format dependency called out in WP-5). Document this generator caveat explicitly in whatever dev-setup doc references this script.
  - Consider a `"sandbox:build:win-cross"` variant using `-DCMAKE_TOOLCHAIN_FILE=<mingw-w64 cross toolchain file>` for cross-compiling `sandbox_run.exe` **from this Linux dev machine** via `x86_64-w64-mingw32-g++` (installable via `apt install g++-mingw-w64-x86-64`, not currently installed). This only cross-compiles the sandbox binary — it does **not** let you test it, since the resulting `.exe` still needs to actually run under Windows or Wine to validate Job Object behavior. Flagged in Open Questions.

**How to verify:** `npm run sandbox:build` (or the Windows-specific variant) produces `toolchain/bin/sandbox_run.exe`; `file toolchain/bin/sandbox_run.exe` reports a PE32+ executable; on a Windows machine, running it with no args prints the usage text to stderr and exits 1.

---

## WP-4 — Windows `sandbox_run` test suite

**Goal:** the same behavioral guarantees `tests/sandbox.test.ts` verifies on Linux (wall timeout, memory kill, stack overflow, stdin piping, output cap, low overhead) verified on Windows.

**Files touched:**
- `tests/sandbox.test.ts`
- `sandbox_run/tests/test_timeout.cpp`, `test_memory.cpp`, `test_stack_overflow.cpp` (staged, currently unwired)

**Important finding — the staged fixtures are not drop-in equivalents of the existing POSIX fixtures, reconcile before wiring them in:**
- `sandbox_run/tests/test_timeout.cpp` (busy-`Sleep()`-loop) is a fine direct analog of the POSIX suite's `sleep()`-loop wall-timeout fixture — safe to adapt as-is.
- `sandbox_run/tests/test_stack_overflow.cpp` (recursive function with a 4096-byte local buffer) is a fine direct analog of the POSIX suite's stack-overflow fixture — safe to adapt as-is, and this is the one that actually exercises the `"sigsegv"` mapping from WP-1 (`STATUS_STACK_OVERFLOW`).
- `sandbox_run/tests/test_memory.cpp` is **not** equivalent to the POSIX suite's memory fixture and will not produce `killed_by:"memory"` as currently written: it loops calling `VirtualAlloc` and does `if (!ptr) break;` — i.e. it treats allocation failure as a **clean exit**, not a crash. Once `JOB_OBJECT_LIMIT_PROCESS_MEMORY` starts failing allocations (WP-1), this fixture will simply `break` out of its loop and return 0 — the sandbox will correctly report `killed_by:null, exit_code:0`, which is *correct enforcement behavior* but does not exercise or prove the `"memory"` classification path at all. The POSIX suite's actual memory fixture (`tests/sandbox.test.ts` lines 44–51) deliberately does `new char[1024*1024]` in an unchecked loop specifically so the uncaught `std::bad_alloc` crashes the process — that's the behavior that needs a Windows equivalent. Recommend: **write a new Windows memory fixture using `new[]` (or adapt `test_memory.cpp` to drop the `if (!ptr) break` guard and let `new`/`malloc` throw/fail uncaught)**, so the stderr-`bad_alloc`-substring heuristic from WP-1 actually gets exercised. Flag this fixture mismatch explicitly when doing the adaptation — it's an easy thing to port silently and end up with a green test that isn't testing what it looks like it's testing.
- Recommended approach: rather than importing the staged `.cpp` files as separate compiled fixtures with their own Win32-specific `#include <windows.h>` bodies, extend `tests/sandbox.test.ts`'s `compileFixture()` helper to be platform-aware — keep the fixture **source strings inline in the test file** (as it already does for POSIX) but branch the handful of platform-specific calls (`sleep()` → `Sleep()`, keep `new[]`/recursion identical since those are portable C++). This keeps one test file exercising equivalent C++ semantics on both platforms rather than two divergent fixture sets that could silently drift, and avoids the `test_memory.cpp` mismatch above by construction (the `new[]`-loop fixture source is shared, not Windows-fork-specific).
- `compileFixture()` currently hardcodes `spawnSync('g++', [...])` (`tests/sandbox.test.ts:13`) — on Windows this needs to resolve the compiler the same way the runner does (WP-5's `windows-native` lock profile), not assume `g++` is bare on `PATH`; otherwise this test file has its own undocumented toolchain dependency separate from the one WP-5 sets up for the app itself.
- `SANDBOX_PATH` (`tests/sandbox.test.ts:7`) is hardcoded without `.exe` — same issue as `findProjectRoot()` (WP-6), needs a platform-aware suffix or an existence check for both names.

**How to verify:** `npm run test` (vitest) green on a Windows machine (or under Wine — see Open Questions), covering all six existing assertions plus confirming the corrected memory fixture actually produces `killed_by:"memory"`.

---

## WP-CI — GitHub Actions Windows verification workflow

**Goal:** every push to the `Windows` branch builds `sandbox_run.exe` with MinGW-w64 on a real `windows-latest` runner and runs the sandbox test suite against it. This is the phase's answer to "no Windows box": the dev loop is *cross-compile-check locally on the ARM64 Linux box → push → read CI results*. Slower per iteration than a local box, but it tests real Windows semantics instead of an emulation guess, and it becomes the repo's permanent Windows CI after the phase ends.

**Files touched:**
- `.github/workflows/windows.yml` (new — no `.github/` directory exists today)

**What it does:**
- Trigger: `push`/`pull_request` on the `Windows` branch (widen to `master`/`dev` once merged).
- Runner: `windows-latest`. GitHub's Windows runners ship an MSYS2/MinGW-w64 g++ preinstalled; the workflow should pin/select the MinGW toolchain explicitly (e.g. `msys2/setup-msys2` action or the preinstalled `C:\mingw64`) rather than letting CMake find MSVC — same GCC-diagnostics rationale as WP-5.
- Steps: checkout → configure CMake with the MinGW generator → build `sandbox_run.exe` → `npm ci` → run the WP-4 vitest sandbox suite → (once WP-5/WP-6 land) `npm run toolchain:verify` and `npm run lessons:validate` as later, broader gates.
- Artifact-upload the built `sandbox_run.exe` so a known-good Windows binary is downloadable from any green run (useful for WP-7's manual session and for the bundling decision in Open Question 4).

**How to verify:** the workflow itself is the verifier — a green run on `windows-latest` is this phase's definition of "behaviorally verified" for WP-0–WP-6. Note CI minutes: free for public repos; private repos draw from the plan's minute pool with Windows at a 2× multiplier — fine at this scale either way.

---

## WP-5 — Toolchain: MinGW-w64 sourcing + `windows-native` profile

**Goal:** a working Windows C++ compiler the runner can invoke, registered in `toolchain.lock.json`, selected automatically based on `process.platform`.

**Files touched:**
- `toolchain/toolchain.lock.json`
- `runner/src/index.ts` (`getCompilerPath()`)
- `runner/src/combat.ts` (its near-identical `getCompilerPath()` copy)
- `scripts/verify-toolchain.ts` (no code change expected — confirm it works unmodified)

**Compiler choice — MinGW-w64 g++, not MSVC/clang-cl. Recommendation, with justification (not left open):**
- `runner/src/error_table.ts` is a table of ~regexes matched verbatim against **GCC's diagnostic text format** (`"expected ',' or ';' before"`, `"invalid conversion from ... to ..."`, `"return-statement with a value ... function returning 'void'"`, `"redeclaration"/"redefinition of"`, etc.). This is the mechanism that drives every in-game friendly compile-error hint. Confirmed by reading the file directly — its header comment literally says "Error classification for g++ compiler diagnostics." MSVC's `cl.exe` diagnostic format is structurally different (different wording, different punctuation, different multi-line layout, `C####`-prefixed error codes instead of GCC's free-text style) and would silently break `classifyFirstError()` for every error type on Windows, degrading every compile-error lesson to a generic fallback message. `clang-cl` in MSVC-compatibility-diagnostics mode has the same problem; `clang-cl` in Clang-native-diagnostics mode is closer to GCC's phrasing in places but still meaningfully different and unverified against this exact table.
- MinGW-w64 g++ produces the **same GCC diagnostic family** the Linux profile already uses and the error table is already built against, meaning `error_table.ts` needs zero changes for Windows — a large, otherwise-invisible source of Windows-specific breakage is avoided entirely by this compiler choice.
- Command-line flag compatibility is also a wash in MinGW's favor: `runner/src/index.ts`'s `compileCmd` uses `-std=c++17 -O0 -g0 -Wall` — all valid, identically-behaved GCC flags; MSVC's equivalent flags (`/std:c++17 /Od /W3` etc.) are different spellings entirely and would require a second, parallel flag-building code path.
- Sourcing: no system compiler exists on a bare Windows install, so — unlike the Linux profile, which points at `/usr/bin/g++` and assumes it's already there — the Windows profile needs an actual compiler bundled or fetched. Recommend bundling a static, portable MinGW-w64 distribution (e.g. a WinLibs or MSYS2 `mingw64` release archive) under `toolchain/mingw64/` (or downloaded on first run by an extended `scripts/fetch-toolchain.ts` — see below), with the lock profile's `path` pointing at `toolchain/mingw64/bin/g++.exe`.
- `toolchain.lock.json` gains a new profile:
  ```json
  "windows-native": {
    "type": "system",
    "compiler": "g++",
    "path": "<repo>/toolchain/mingw64/bin/g++.exe",
    "platform": "win32",
    "used_for": "local lesson compiles on Windows",
    "extra_flags": ["-static-libgcc", "-static-libstdc++"]
  }
  ```
  `type: "system"` is deliberate even though the compiler is bundled, not actually system-installed: `scripts/fetch-toolchain.ts` and `scripts/verify-toolchain.ts` both already branch purely on `type === 'system'` and otherwise treat any profile generically (iterate, run `--version`, compile+run a hello-world) — they need **zero code changes** if the profile is typed this way. `fetch-toolchain.ts`'s `type: 'system'` branch today is a no-op ("no fetch needed") — if bundling requires an actual download step (rather than committing a MinGW archive to the repo, which is a large binary blob decision worth a separate discussion with Bryson), this no-op needs a real download+extract implementation, which is new code, not a "works unmodified" case; flag this explicitly as a decision point rather than assuming it away.
  The `extra_flags` field is new — `getCompilerPath()` (both copies) currently only reads `.path`; extend it to also read `.extra_flags` (default `[]`) and merge those into the compile invocation, motivated by the static-runtime-linking need explained in WP-3 (player-submitted lesson code compiled by this profile should also not require `libstdc++-6.dll`/`libgcc_s_seh-1.dll` on the player's machine — every `lesson.exe` needs the same static-linking treatment `sandbox_run.exe` itself gets).
- `getCompilerPath()` becomes platform-aware instead of hardcoding `'linux-native'`:
  ```ts
  function getCompilerPath(): string {
    const lockPath = path.join(TOOLCHAIN_DIR, 'toolchain.lock.json');
    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    const profileKey = process.platform === 'win32' ? 'windows-native' : 'linux-native';
    const profile = lockData.profiles?.[profileKey];
    if (profile?.path) return profile.path;
    return process.platform === 'win32' ? 'g++' : '/usr/bin/g++'; // fallback
  }
  ```
  Apply identically to the copy in `combat.ts`. (Longer-term this duplicated function is a candidate for extraction into a shared module — not required for this phase, flag as a nice-to-have.)

**How to verify:** `npm run toolchain:verify` on Windows reports `OK windows-native: <g++ version line>` and successfully compiles+runs a hello-world; `getCompilerPath()` unit-testable by mocking `process.platform`.

---

## WP-6 — Runner path-safety fixes

**Goal:** the runner doesn't crash on startup or on every compile/execute call on Windows.

**Files touched:**
- `runner/src/index.ts`
- `runner/src/combat.ts`

**What changes:**
- `findProjectRoot()` (defined near-identically in both files — `index.ts:13-23`, `combat.ts:11-21`) checks `fs.existsSync(path.join(dir, 'toolchain', 'bin', 'sandbox_run'))`, hardcoded without `.exe`. On Windows the file is `sandbox_run.exe`; as written this throws `Project root with toolchain/bin/sandbox_run not found above ...` and crashes runner init before anything else runs. Fix (identically in both copies):
  ```ts
  function sandboxRunExists(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'toolchain', 'bin', 'sandbox_run')) ||
           fs.existsSync(path.join(dir, 'toolchain', 'bin', 'sandbox_run.exe'));
  }
  ```
  and use it in the `while` condition in place of the inline `existsSync` call. (Given this exact function is duplicated in three places now — `index.ts`, `combat.ts`, and implicitly re-derivable in `tests/sandbox.test.ts`'s hardcoded `SANDBOX_PATH` — worth flagging as a good candidate to extract into one shared `runner/src/project-root.ts` module during this same change, since fixing it in two places by hand is exactly how this kind of drift happens again next time.)
- `SANDBOX_RUN`/`sandboxCmd` construction (`index.ts:201`, `combat.ts:26,173`) currently builds `path.join(TOOLCHAIN_DIR, 'bin', 'sandbox_run')` without `.exe` — resolve the actual on-disk filename explicitly (reuse the same `sandbox_run`/`sandbox_run.exe` existence check) rather than hoping Windows path resolution papers over it, especially once the shell-string invocation is removed (see below) — `execFileSync` with `shell:false` does **not** do PATHEXT resolution on an explicit path the way `cmd.exe` would.
- **`execSync` → `execFileSync`/argument-array conversion.** Both files currently build a full command string via template-literal interpolation and pass it to `execSync(cmd, {...})`, which spawns `/bin/sh -c <string>` on POSIX and `cmd.exe /c <string>` on Windows by default — different quoting rules, especially for paths containing spaces (e.g. anything under `C:\Program Files\` or a username with a space in it, both realistic on a real Windows install). Convert to `execFileSync(file, argsArray, opts)` at each of these call sites, which passes the argument vector directly to the OS process-creation API on both platforms and sidesteps shell quoting entirely:
  - `runner/src/index.ts:173` — the compile command (`compileCmd` string, `COMPILER_PATH -std=c++17 ... -o exePath`) → `execFileSync(COMPILER_PATH, ['-std=c++17', '-O0', '-g0', '-Wall', ...extraFlags, ...pchFlagParts, '-I'+..., '-I'+..., mainCpp, gameapiCpp, ...extraUnitPaths, '-o', exePath], {...})`.
  - `runner/src/index.ts:206` — the sandbox invocation (`sandboxCmd` string) → `execFileSync(sandboxRunPath, ['--wall-ms', String(limits.wall_ms), '--cpu-ms', String(limits.cpu_ms), '--mem-mb', String(limits.mem_mb), '--stdout-cap-kb', String(limits.stdout_cap_kb), ...(stdinPath ? ['--stdin-file', stdinPath] : []), '--', exePath], {...})`.
  - `runner/src/combat.ts:163,166` — same conversion for the combat-harness compile command.
  - `runner/src/combat.ts:173,176` — same conversion for the combat-harness sandbox invocation.
  - Note the current `stdinFlag`/other flags are built as *space-joined string fragments* today (e.g. `stdinFlag = '--stdin-file ${stdinPath}'`, then spliced into the larger command string) — these need to become proper array *elements* (`'--stdin-file'`, `stdinPath` as two separate array entries), not string concatenation, or the quoting problem just moves one level down.
  - `scripts/lesson-runner.js` is explicitly out of scope per prior investigation (already-broken/legacy, references dead PCH) — do not touch it in this phase; note in a comment or commit message that it's a known-stale script, not silently left broken by omission.
  - `catch (e: any)` blocks around these calls already read `e.stdout`/`e.stderr` — `execFileSync` populates the same `error.stdout`/`error.stderr` fields on non-zero exit as `execSync` does, so the existing error-handling shape carries over unchanged.

**How to verify:** on Linux (regression check, since this touches the only-currently-tested platform too), `npm run test` and `npm run lessons:validate` stay green after the conversion — this is the safest way to prove the argv-array conversion didn't change quoting/argument-splitting behavior versus the old string-based `execSync` calls, before ever touching a Windows machine.

---

## WP-7 — End-to-end verification (the actual deliverable: plays on Windows)

**Goal:** confirm the full stack — compile, sandbox-run, validate, render in Electron — works together on Windows. This is the task that turns "the pieces compile" into "you can actually play the game."

**Files touched:** none (verification only), possibly minor fixups discovered during this pass feed back into WP-0–WP-6.

**What changes / verification sequence:**
1. `npm run toolchain:verify` — confirms `windows-native` profile resolves and compiles+runs hello-world (WP-5).
2. `npm run sandbox:build` (WP-3) then `npm run test` (vitest, includes the Windows `sandbox.test.ts` assertions from WP-4).
3. `npm run lessons:validate` — runs every lesson's starter/solution code through the real compile+sandbox pipeline; this is the broadest smoke test available today and will surface any remaining Windows-specific compile/exec issue across the full lesson content set, not just the handful of hand-picked sandbox tests.
4. `scripts/e2e-drive.ts`'s existing `--max-zone` driven smoke path (manifest-agnostic, so should need no code change) — run against however many zones are practical.
5. Manual play session: `npm run build` (renderer) then `npx electron .` (or `npm run electron:dev`) on an actual Windows machine — load a save, play through a few lessons of different `kind` (`program` and `functions`), confirm a compile error renders its friendly hint (this is the concrete proof that the MinGW-diagnostics choice in WP-5 paid off), confirm a runtime crash lesson (e.g. one of the `EXIT_STATUS_ROWS` stack-overflow-teaching lessons) renders correctly.

**How to verify:** all of the above pass on a real (or Wine-emulated — see Open Questions) Windows environment. This is the milestone this doc calls "compiles and plays via `npx electron .` on Windows" — treat it as the phase's actual finish line; WP-8 is explicitly a stretch goal beyond it.

---

## WP-8 — *(optional, later)* electron-builder packaging

**Goal:** a real installable `.exe`/installer, as a nice-to-have beyond "runs from source."

**Files touched:**
- `package.json` (new `"build"` key, new `"electron:package"`-style script)
- Possibly a new `electron-builder.yml` if the config grows past what's comfortable inline in `package.json`

**What changes:**
- `electron-builder` and `electron-builder-squirrel-windows` are already present as devDependencies but invoked by nothing (`"electron:build"` today only runs the Vite renderer build, not app packaging). Add a minimal `"build"` config block: `appId`, `productName`, `files` (needs to include `dist/`, `ui/dist/`, `content/`, `gameapi/`, `toolchain/` — notably the bundled MinGW distribution and `sandbox_run.exe` from WP-3/WP-5, which is a nontrivial amount of bytes to decide whether to ship inside the installer vs. fetch post-install), and `win: { target: ['nsis'] }` (or `squirrel`, matching the already-present `electron-builder-squirrel-windows` devDependency — pick one, don't half-configure both; `nsis` is the more common/default electron-builder target and needs no extra devDependency, so it's the lower-friction default unless there's a specific reason to prefer Squirrel).
- Add an `"electron:package:win"` script wrapping `electron-builder --win`.
- This task is explicitly **lower priority than WP-0–WP-7** — do not let packaging concerns (code signing, installer UX, auto-update wiring) block or gate the earlier phases.

**How to verify:** `npm run electron:package:win` (on Windows, or cross-built via electron-builder's Linux→Windows target support, which is itself an open question re: whether `wine` is needed for that path too) produces an installer; running the installer and launching the installed app reaches the same "plays" verification as WP-7.

---

## Open Questions / Assumptions (flagged, not decided)

1. **~~No confirmed access to a physical Windows dev machine.~~ RESOLVED (2026-07-12): GitHub Actions `windows-latest` is the verification environment — now a first-class task, WP-CI above.** WP-0/WP-1/WP-2's runtime verification (Job Object behavior, exception mapping to `0xC00000FD`/`0xC0000005`, the pipe-handle-inheritance EOF-hang bug) runs on real Windows in CI; local work on the ARM64 Linux box is compile-check-only via cross-compilation (`x86_64-w64-mingw32-g++` via `apt install g++-mingw-w64-x86-64`). The workflow doubles as the repo's long-term Windows CI for WP-4's suite. The one thing CI can't cover — WP-7 step 5's manual `npx electron .` play session — is Bryson's, on a physical Windows machine, after the automated stack is green.
2. **MinGW vs. MSVC** — resolved above as a recommendation (MinGW-w64), not left open, on the strength of the `error_table.ts` GCC-diagnostic-format dependency. Flagging the reasoning explicitly here anyway: if Bryson has a strong reason to want MSVC (e.g. better long-term Windows toolchain support, matching what real-world C++ Windows devs use), that would require a parallel MSVC-diagnostic error table as a prerequisite, which is a meaningfully larger scope addition than anything else in this document — worth a deliberate go/no-go conversation rather than discovering it mid-implementation.
3. **Cross-compiling `sandbox_run.exe` from Linux via mingw-w64 is viable for *building* without a Windows box, but not for *testing*.** It gets you a `.exe` that's plausibly correct by inspection, but Job Object / pipe / structured-exception behavior cannot be exercised on Linux even under Wine with full fidelity (Wine's Job Object and SEH emulation is decent but not identical to real Windows, and is itself an unverified variable). Treat cross-compiled-but-Wine-tested as a *lower-confidence* substitute for real-Windows testing, useful for iteration speed during WP-0–WP-2 development, not as a substitute for the WP-7 verification pass.
4. **~~Bundling vs. fetching MinGW-w64 (WP-5)~~ RESOLVED (2026-07-12, Bryson): fetch on first run.** `scripts/fetch-toolchain.ts` now implements a real download+verify+extract step, driven by a `fetch` block in the lock profile: pinned WinLibs GCC 13.2.0 UCRT (no-LLVM variant, ~215 MB zip, SHA256-verified against the release's published checksum, extraction via Windows' built-in bsdtar — zero new npm deps). The `windows-native` profile's `path` is repo-relative (`toolchain/mingw64/bin/g++.exe`); all consumers (both `getCompilerProfile()` copies, the test suite, `verify-toolchain.ts`) resolve it against the project root and fall back to `g++` on PATH when the fetch hasn't run yet. Windows playtest setup is: clone → `npm ci` → `npm run toolchain:fetch` → play. CI runs the same fetch step (cached on the archive checksum), so the fetch code itself is exercised on real Windows every pin bump. GCC 13.2 keeps the diagnostics in the same GCC-13 family as the Linux profile (13.3), preserving the `error_table.ts` contract.
5. **`toolchain/bin/sandbox_run.exe` and player `lesson.exe` binaries being flagged by Windows Defender / SmartScreen** — sandboxed processes being spawned rapidly with resource limits from an unsigned freshly-compiled `.exe` is a pattern that can trip antivirus heuristics on a real Windows machine in ways it never would on Linux. Not addressed anywhere in this plan; worth keeping in mind during WP-7's manual play-session verification, and is a separate, likely lower-priority follow-up (code signing) if it turns out to be a real problem in practice.

---

### Critical Files for Implementation

- `sandbox_run/src/sandbox_win.cpp` — the core blocker; entire WP-0/WP-1/WP-2 rewrite target
- `sandbox_run/src/sandbox_posix.cpp` — reference implementation whose behavioral contract must be matched
- `sandbox_run/CMakeLists.txt` — WP-3 build config
- `runner/src/index.ts` — WP-5/WP-6 (`getCompilerPath()`, `findProjectRoot()`, `execSync`→`execFileSync` conversions)
- `runner/src/combat.ts` — duplicate copies of the same WP-5/WP-6 fixes
- `toolchain/toolchain.lock.json` — WP-5 new `windows-native` profile
- `tests/sandbox.test.ts` — WP-4 test suite, authoritative behavioral spec for the whole port
