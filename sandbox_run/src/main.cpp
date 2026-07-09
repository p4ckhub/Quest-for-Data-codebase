#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <unistd.h>
#include <sys/stat.h>
#include <fcntl.h>

// Include the sandbox header for struct definitions
#include "sandbox.h"

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
        char template_str[] = "/tmp/sandbox_XXXXXX";
        char* res = mkdtemp(template_str);
        if (!res) {
            fprintf(stderr, "Failed to create temp directory\n");
            return 1;
        }
        tmp_cwd = template_str;
        config.cwd = tmp_cwd;
    }
    
    auto result = run_sandboxed(config);
    
    if (!tmp_cwd.empty()) {
        std::string rm_cmd = "rm -rf " + tmp_cwd;
        system(rm_cmd.c_str());
    }
    
    return 0;
}
