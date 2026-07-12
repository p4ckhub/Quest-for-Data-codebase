#include <windows.h>
#include <process.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <chrono>
#include <fstream>
#include <sstream>
#include <atomic>
#include <iostream>

// Include the sandbox header for struct definitions
#include "sandbox.h"

namespace {

std::atomic<bool> process_killed{false};

// Why the watchdog sets an enum instead of writing RunResult.killed_by directly:
// std::string assignment is not safe across threads; the main thread translates
// after joining the watchdog.
enum KilledReason : LONG {
    KILLED_NONE = 0,
    KILLED_WALL = 1,
    KILLED_CPU = 2,
};

struct WatchdogContext {
    HANDLE process;
    HANDLE job;
    uint64_t wall_ms;
    uint64_t cpu_ms;
    std::atomic<LONG>* killed_reason;
    std::atomic<bool>* stop;
};

uint64_t job_cpu_ms(HANDLE job) {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
    if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
                                   &info, sizeof(info), nullptr)) {
        return 0;
    }
    // Job accounting sums every process ever assigned to the job — the parity
    // equivalent of the POSIX code's getrusage(RUSAGE_CHILDREN). 100ns units.
    return static_cast<uint64_t>(
        (info.TotalUserTime.QuadPart + info.TotalKernelTime.QuadPart) / 10000);
}

// Native thread (not std::thread): MinGW-w64's std::thread can pull in
// libwinpthread-1.dll depending on the distribution's threading model.
unsigned __stdcall watchdog_main(void* param) {
    auto* ctx = static_cast<WatchdogContext*>(param);
    auto start = std::chrono::high_resolution_clock::now();

    while (!ctx->stop->load() && !process_killed.load()) {
        // Doubles as the ~10ms tick (mirrors the POSIX monitor thread cadence).
        if (WaitForSingleObject(ctx->process, 10) == WAIT_OBJECT_0) {
            break;
        }

        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::high_resolution_clock::now() - start).count();

        if (ctx->wall_ms > 0 && elapsed >= static_cast<int64_t>(ctx->wall_ms)) {
            ctx->killed_reason->store(KILLED_WALL);
            process_killed.store(true);
            // Kills the whole job (child + any grandchildren), unlike the
            // POSIX version's kill(pid, SIGKILL) which only hits the child.
            TerminateJobObject(ctx->job, 1);
            break;
        }

        // No RLIMIT_CPU/SIGXCPU equivalent on Windows — poll job accounting.
        if (ctx->cpu_ms > 0 && job_cpu_ms(ctx->job) >= ctx->cpu_ms) {
            ctx->killed_reason->store(KILLED_CPU);
            process_killed.store(true);
            TerminateJobObject(ctx->job, 1);
            break;
        }
    }
    return 0;
}

// Quote one argument per the MSVCRT/CommandLineToArgvW rules. CreateProcess
// takes a single command-line string, so this is unavoidable Windows-specific
// work with real escaping subtleties (backslash runs before quotes double).
std::string quote_arg(const std::string& arg) {
    if (!arg.empty() && arg.find_first_of(" \t\n\v\"") == std::string::npos) {
        return arg;
    }
    std::string out = "\"";
    auto it = arg.begin();
    while (true) {
        size_t backslashes = 0;
        while (it != arg.end() && *it == '\\') {
            ++it;
            ++backslashes;
        }
        if (it == arg.end()) {
            out.append(backslashes * 2, '\\');
            break;
        }
        if (*it == '"') {
            out.append(backslashes * 2 + 1, '\\');
            out.push_back('"');
        } else {
            out.append(backslashes, '\\');
            out.push_back(*it);
        }
        ++it;
    }
    out.push_back('"');
    return out;
}

// Read whatever is available on the pipe without blocking. Windows anonymous
// pipes support neither poll() nor non-blocking ReadFile; PeekNamedPipe +
// conditional ReadFile is the standard substitute.
// Returns true if bytes were consumed; sets done on EOF/broken pipe.
bool drain_pipe(HANDLE pipe, std::ostringstream& buffer, bool& done) {
    if (done) return false;
    DWORD avail = 0;
    if (!PeekNamedPipe(pipe, nullptr, 0, nullptr, &avail, nullptr)) {
        // ERROR_BROKEN_PIPE: all write handles closed and buffer drained — EOF.
        done = true;
        return false;
    }
    if (avail == 0) return false;
    char buf[4096];
    DWORD n = 0;
    DWORD to_read = avail < sizeof(buf) ? avail : static_cast<DWORD>(sizeof(buf));
    if (!ReadFile(pipe, buf, to_read, &n, nullptr) || n == 0) {
        done = true;
        return false;
    }
    buffer.write(buf, n);
    return true;
}

void close_handle(HANDLE& h) {
    if (h != nullptr && h != INVALID_HANDLE_VALUE) {
        CloseHandle(h);
        h = nullptr;
    }
}

} // anonymous namespace

RunResult run_sandboxed(const RunConfig& config) {
    RunResult result{0, 0, 0, ""};

    auto start_time = std::chrono::high_resolution_clock::now();

    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE stdin_rd = nullptr, stdin_wr = nullptr;
    HANDLE stdout_rd = nullptr, stdout_wr = nullptr;
    HANDLE stderr_rd = nullptr, stderr_wr = nullptr;

    // For each pipe, immediately mark the end the parent keeps as
    // non-inheritable. CreateProcess with bInheritHandles=TRUE inherits every
    // inheritable handle in the parent, not just the STARTUPINFO ones — if the
    // child inherits a copy of our read end, the pipe never reports EOF after
    // the child exits and the read loop hangs forever.
    if (!CreatePipe(&stdin_rd, &stdin_wr, &sa, 0) ||
        !SetHandleInformation(stdin_wr, HANDLE_FLAG_INHERIT, 0)) {
        result.killed_by = "internal_error";
        return result;
    }
    if (!CreatePipe(&stdout_rd, &stdout_wr, &sa, 0) ||
        !SetHandleInformation(stdout_rd, HANDLE_FLAG_INHERIT, 0)) {
        close_handle(stdin_rd); close_handle(stdin_wr);
        result.killed_by = "internal_error";
        return result;
    }
    if (!CreatePipe(&stderr_rd, &stderr_wr, &sa, 0) ||
        !SetHandleInformation(stderr_rd, HANDLE_FLAG_INHERIT, 0)) {
        close_handle(stdin_rd); close_handle(stdin_wr);
        close_handle(stdout_rd); close_handle(stdout_wr);
        result.killed_by = "internal_error";
        return result;
    }

    STARTUPINFOA si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = stdin_rd;
    si.hStdOutput = stdout_wr;
    si.hStdError = stderr_wr;

    std::string cmdline = quote_arg(config.exe);
    for (const auto& arg : config.args) {
        cmdline += ' ';
        cmdline += quote_arg(arg);
    }
    // CreateProcess may write into the command-line buffer; can't pass c_str().
    std::vector<char> cmdline_buf(cmdline.begin(), cmdline.end());
    cmdline_buf.push_back('\0');

    PROCESS_INFORMATION pi{};
    // CREATE_SUSPENDED: attach the job + limits before the child runs a single
    // instruction (avoids a window where it could allocate past the cap or
    // spawn grandchildren outside the job). CREATE_NO_WINDOW: no console flash
    // when invoked from Electron's main process.
    BOOL created = CreateProcessA(
        nullptr, cmdline_buf.data(), nullptr, nullptr,
        TRUE /* bInheritHandles */,
        CREATE_SUSPENDED | CREATE_NO_WINDOW,
        nullptr,
        config.cwd.empty() ? nullptr : config.cwd.c_str(),
        &si, &pi);

    // Parent doesn't use the child-side ends; holding them open would also
    // defeat EOF detection on the read loop.
    close_handle(stdin_rd);
    close_handle(stdout_wr);
    close_handle(stderr_wr);

    if (!created) {
        // Parity with the POSIX child's execvp-failure path: _exit(127).
        close_handle(stdin_wr);
        close_handle(stdout_rd);
        close_handle(stderr_rd);
        result.exit_code = 127;
        auto end_time = std::chrono::high_resolution_clock::now();
        result.wall_ms = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time).count());
        std::cout << "@@RESULT@@ {\"exit_code\":127,\"wall_ms\":" << result.wall_ms
                  << ",\"cpu_ms\":0,\"killed_by\":null}" << std::endl;
        return result;
    }

    HANDLE hJob = CreateJobObjectA(nullptr, nullptr);
    if (hJob) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli{};
        jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (config.mem_mb > 0) {
            // Like RLIMIT_AS on Linux, this doesn't kill the process — it makes
            // allocations past the cap fail, and the child's uncaught
            // std::bad_alloc → abort() is what we detect (stderr heuristic below).
            jeli.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            jeli.ProcessMemoryLimit = static_cast<SIZE_T>(config.mem_mb) * 1024 * 1024;
        }
        SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
        AssignProcessToJobObject(hJob, pi.hProcess);
    }

    ResumeThread(pi.hThread);
    close_handle(pi.hThread);

    // Write-then-close before entering the read loop (same ordering as the
    // POSIX version). With no --stdin-file the immediate close means the
    // child's cin sees instant EOF — never the parent's real stdin.
    if (!config.stdin_file.empty()) {
        std::ifstream infile(config.stdin_file, std::ios::binary);
        std::stringstream buffer;
        buffer << infile.rdbuf();
        std::string content = buffer.str();

        size_t written = 0;
        while (written < content.size()) {
            DWORD n = 0;
            if (!WriteFile(stdin_wr, content.c_str() + written,
                           static_cast<DWORD>(content.size() - written), &n, nullptr) || n == 0) {
                break;
            }
            written += n;
        }
    }
    close_handle(stdin_wr);

    process_killed.store(false);
    std::atomic<LONG> killed_reason{KILLED_NONE};
    std::atomic<bool> stop_watchdog{false};

    WatchdogContext ctx{pi.hProcess, hJob, config.wall_ms, config.cpu_ms,
                        &killed_reason, &stop_watchdog};
    HANDLE hWatchdog = reinterpret_cast<HANDLE>(
        _beginthreadex(nullptr, 0, watchdog_main, &ctx, 0, nullptr));

    std::ostringstream stdout_buffer;
    std::ostringstream stderr_buffer;

    bool stdout_done = false;
    bool stderr_done = false;
    uint64_t output_cap_bytes = config.stdout_cap_kb * 1024;

    while (!stdout_done || !stderr_done) {
        bool got_data = false;
        got_data |= drain_pipe(stdout_rd, stdout_buffer, stdout_done);

        if (!stdout_done &&
            static_cast<uint64_t>(stdout_buffer.tellp()) >= output_cap_bytes) {
            result.killed_by = "output_cap";
            process_killed.store(true);
            TerminateJobObject(hJob, 1);
            WaitForSingleObject(pi.hProcess, INFINITE);
            break;
        }

        got_data |= drain_pipe(stderr_rd, stderr_buffer, stderr_done);

        if (!got_data) {
            Sleep(10);
        }
    }

    close_handle(stdout_rd);
    close_handle(stderr_rd);

    // Pipes at EOF doesn't mean the process exited (it may have closed stdout
    // and kept running) — the watchdog's wall timeout guarantees this returns.
    WaitForSingleObject(pi.hProcess, INFINITE);

    stop_watchdog.store(true);
    if (hWatchdog) {
        WaitForSingleObject(hWatchdog, INFINITE);
        CloseHandle(hWatchdog);
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    result.wall_ms = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time).count());

    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    result.exit_code = static_cast<int>(exit_code);

    if (result.killed_by.empty()) {
        switch (killed_reason.load()) {
            case KILLED_WALL: result.killed_by = "wall_timeout"; break;
            case KILLED_CPU:  result.killed_by = "cpu_timeout";  break;
            default: break;
        }
    }

    // Structured-exception deaths map to the same string a POSIX SIGSEGV
    // produces. The raw NTSTATUS still passes through in exit_code — the
    // validator matches either, but mapOutcome() branches on the string.
    if (result.killed_by.empty() &&
        (exit_code == 0xC0000005 /* STATUS_ACCESS_VIOLATION */ ||
         exit_code == 0xC00000FD /* STATUS_STACK_OVERFLOW */)) {
        result.killed_by = "sigsegv";
    }

    // Same heuristic as sandbox_posix.cpp: the job memory limit makes
    // allocations fail rather than killing the process, so an uncaught
    // bad_alloc's abort message on stderr is the "memory" signal.
    std::string stderr_str = stderr_buffer.str();
    if (result.killed_by.empty() && exit_code != 0 &&
        stderr_str.find("bad_alloc") != std::string::npos) {
        result.killed_by = "memory";
    }

    result.cpu_ms = hJob ? job_cpu_ms(hJob) : 0;

    close_handle(pi.hProcess);
    close_handle(hJob);

    // exit_code prints as unsigned: NTSTATUS values like STATUS_STACK_OVERFLOW
    // must reach the validator as 3221225725, not a sign-extended negative.
    std::ostringstream json_out;
    json_out << "{\"exit_code\":" << static_cast<uint32_t>(result.exit_code)
             << ",\"wall_ms\":" << result.wall_ms
             << ",\"cpu_ms\":" << result.cpu_ms;

    if (result.killed_by.empty()) {
        json_out << ",\"killed_by\":null}";
    } else {
        json_out << ",\"killed_by\":\"" << result.killed_by << "\"}";
    }

    // Print captured stdout first (may be truncated by cap)
    std::string stdout_str = stdout_buffer.str();
    if (!stdout_str.empty()) {
        std::cout << stdout_str;
    }

    std::cout << "@@RESULT@@ " << json_out.str() << std::endl;

    return result;
}

bool parse_args(int argc, char* argv[], RunConfig& config) {
    int i = 1;

    while (i < argc) {
        std::string arg = argv[i];

        if (arg == "--wall-ms" && i + 1 < argc) {
            config.wall_ms = std::stoull(argv[++i]);
        } else if (arg == "--cpu-ms" && i + 1 < argc) {
            config.cpu_ms = std::stoull(argv[++i]);
        } else if (arg == "--mem-mb" && i + 1 < argc) {
            config.mem_mb = std::stoul(argv[++i]);
        } else if (arg == "--stdout-cap-kb" && i + 1 < argc) {
            config.stdout_cap_kb = std::stoul(argv[++i]);
        } else if (arg == "--stdin-file" && i + 1 < argc) {
            config.stdin_file = argv[++i];
        } else if (arg == "--cwd" && i + 1 < argc) {
            config.cwd = argv[++i];
        } else if (arg == "--") {
            i++;
            if (i >= argc) return false;
            config.exe = argv[i];
            i++;
            while (i < argc) {
                config.args.push_back(argv[i]);
                i++;
            }
        } else {
            if (config.exe.empty()) {
                config.exe = arg;
            } else {
                config.args.push_back(arg);
            }
        }

        i++;
    }

    return !config.exe.empty();
}

namespace {

// No-shell replacement for the POSIX version's system("rm -rf ...").
void delete_recursive(const std::string& dir) {
    WIN32_FIND_DATAA fd;
    HANDLE hFind = FindFirstFileA((dir + "\\*").c_str(), &fd);
    if (hFind != INVALID_HANDLE_VALUE) {
        do {
            std::string name = fd.cFileName;
            if (name == "." || name == "..") continue;
            std::string path = dir + "\\" + name;
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                delete_recursive(path);
            } else {
                DeleteFileA(path.c_str());
            }
        } while (FindNextFileA(hFind, &fd));
        FindClose(hFind);
    }
    RemoveDirectoryA(dir.c_str());
}

} // anonymous namespace

int main(int argc, char* argv[]) {
    RunConfig config{};

    config.wall_ms = 3000;
    config.cpu_ms = 2000;
    config.mem_mb = 512;
    config.stdout_cap_kb = 1024;

    if (!parse_args(argc, argv, config)) {
        fprintf(stderr, "Usage: %s [options] -- executable [args...]\n", argv[0]);
        fprintf(stderr, "Options:\n");
        fprintf(stderr, "  --wall-ms N       Wall-clock timeout in ms (default: 3000)\n");
        fprintf(stderr, "  --cpu-ms N        CPU time limit in ms (default: 2000)\n");
        fprintf(stderr, "  --mem-mb N        Memory limit in MB (default: 512)\n");
        fprintf(stderr, "  --stdout-cap-kb N Stdout cap in KB (default: 1024)\n");
        fprintf(stderr, "  --stdin-file Path File to pipe as stdin\n");
        fprintf(stderr, "  --cwd Path        Working directory for child process\n");
        return 1;
    }

    std::string tmp_cwd;
    if (config.cwd.empty()) {
        char temp_path[MAX_PATH];
        DWORD len = GetTempPathA(MAX_PATH, temp_path);
        if (len == 0 || len >= MAX_PATH) {
            fprintf(stderr, "Failed to create temp directory\n");
            return 1;
        }
        char dir_buf[MAX_PATH];
        for (int attempt = 0; attempt < 100; attempt++) {
            snprintf(dir_buf, sizeof(dir_buf), "%ssandbox_%lu_%d",
                     temp_path, GetCurrentProcessId(),
                     static_cast<int>(GetTickCount64() % 1000000) + attempt);
            if (CreateDirectoryA(dir_buf, nullptr)) {
                tmp_cwd = dir_buf;
                break;
            }
        }
        if (tmp_cwd.empty()) {
            fprintf(stderr, "Failed to create temp directory\n");
            return 1;
        }
        config.cwd = tmp_cwd;
    }

    auto result = run_sandboxed(config);

    if (!tmp_cwd.empty()) {
        delete_recursive(tmp_cwd);
    }

    return 0;
}
