#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

struct RunConfig {
    DWORD wall_ms;
    DWORD cpu_ms;
    DWORD mem_mb;
    DWORD stdout_cap_kb;
    std::string stdin_file;
    std::string cwd;
    std::string exe;
    std::vector<std::string> args;
};

struct RunResult {
    int exit_code;
    DWORD wall_ms;
    DWORD cpu_ms;
    std::string killed_by; // null | "wall_timeout" | "cpu_timeout" | "memory" | "output_cap"
};
// TODO: Implement Job Object creation, limit setting, process spawning,
// stdin/stdout piping, timeout enforcement, and structured result output.
// See main spec §10.2 for requirements.

int main(int argc, char* argv[]) {
    printf("sandbox_run.exe v0.1 (stub)\n");
    printf("Full implementation: see sandbox_run/src/main.cpp\n");
    
    // Parse command line:
    // sandbox_run --wall-ms 3000 --cpu-ms 2000 --mem-mb 512 
    //             --stdout-cap-kb 1024 --stdin-file input.txt
    //             --cwd C:\\sandbox -- lesson.exe arg1
    
    return 0;
}
