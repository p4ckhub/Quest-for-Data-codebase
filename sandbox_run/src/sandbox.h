#ifndef SANDBOX_H
#define SANDBOX_H

#include <string>
#include <vector>
#include <cstdint>

// Configuration for running a process in the sandbox
struct RunConfig {
    uint64_t wall_ms;       // Wall-clock timeout in milliseconds
    uint64_t cpu_ms;        // CPU time limit in milliseconds  
    uint64_t mem_mb;        // Memory limit in megabytes
    uint64_t stdout_cap_kb; // Stdout output cap in kilobytes
    std::string stdin_file;  // Path to input file (empty for no stdin)
    std::string cwd;         // Working directory (fresh temp dir if empty)
    std::string exe;         // Executable path
    std::vector<std::string> args; // Command line arguments (without exe)
};

// Result of running a sandboxed process
struct RunResult {
    int exit_code;
    uint64_t wall_ms;
    uint64_t cpu_ms;
    std::string killed_by;   // "wall_timeout", "cpu_timeout", "memory", "output_cap", or empty/null
};

// Run the sandboxed process (POSIX implementation)
RunResult run_sandboxed(const RunConfig& config);

#endif // SANDBOX_H
