#ifndef SANDBOX_H
#define SANDBOX_H

#include <windows.h>
#include <string>
#include <vector>

// Configuration for running a process in the sandbox
struct RunConfig {
    DWORD wall_ms;      // Wall-clock timeout in milliseconds
    DWORD cpu_ms;       // CPU time limit in milliseconds  
    DWORD mem_mb;       // Memory limit in megabytes
    DWORD stdout_cap_kb; // Stdout output cap in kilobytes
    std::string stdin_file;  // Path to input file (empty for pipe)
    std::string cwd;        // Working directory
    std::string exe;        // Executable path
    std::vector<std::string> args; // Command line arguments
};

// Result of running a sandboxed process
struct RunResult {
    int exit_code;
    DWORD wall_ms;
    DWORD cpu_ms;
    std::string killed_by;   // "wall_timeout", "cpu_timeout", "memory", "output_cap", or null
};

// Create and configure a Job Object for resource limiting
HANDLE create_job_object(const RunConfig& config);

// Spawn a process with the job object attached
BOOL spawn_sandboxed_process(HANDLE job, const RunConfig& config, 
                            PROCESS_INFORMATION* pi, HANDLE* stdin_write,
                            HANDLE* stdout_read);

// Monitor the process and enforce limits
RunResult monitor_process(HANDLE process, HANDLE stdout_read, DWORD wall_ms_limit,
                         DWORD mem_mb_limit, DWORD stdout_cap_kb,
                         DWORD cpu_ms_limit = 0);

#endif // SANDBOX_H
