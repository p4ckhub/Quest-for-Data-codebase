#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <unistd.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <csignal>
#include <ctime>
#include <cerrno>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/time.h>
#include <poll.h>
#include <thread>
#include <chrono>
#include <fstream>
#include <sstream>
#include <memory>
#include <atomic>
#include <iostream>

// Include the sandbox header for struct definitions
#include "sandbox.h"

namespace {

std::atomic<int> kill_signal_received{0};
std::atomic<bool> process_killed{false};

void convert_rusage(const struct rusage& ru, uint64_t& wall_ms, uint64_t& cpu_ms) {
    wall_ms = 0;
    cpu_ms = 0;
    
    if (ru.ru_utime.tv_sec > 0 || ru.ru_utime.tv_usec > 0) {
        cpu_ms += ru.ru_utime.tv_sec * 1000 + ru.ru_utime.tv_usec / 1000;
    }
    if (ru.ru_stime.tv_sec > 0 || ru.ru_stime.tv_usec > 0) {
        cpu_ms += ru.ru_stime.tv_sec * 1000 + ru.ru_stime.tv_usec / 1000;
    }
}

} // anonymous namespace

RunResult run_sandboxed(const RunConfig& config) {
    RunResult result{0, 0, 0, ""};
    
    auto start_time = std::chrono::high_resolution_clock::now();
    
    int stdin_pipe[2];
    int stdout_pipe[2];
    int stderr_pipe[2];
    
    if (pipe(stdin_pipe) < 0) {
        result.killed_by = "internal_error";
        return result;
    }
    if (pipe(stdout_pipe) < 0) {
        close(stdin_pipe[0]); close(stdin_pipe[1]);
        result.killed_by = "internal_error";
        return result;
    }
    if (pipe(stderr_pipe) < 0) {
        close(stdin_pipe[0]); close(stdin_pipe[1]);
        close(stdout_pipe[0]); close(stdout_pipe[1]);
        result.killed_by = "internal_error";
        return result;
    }
    
    pid_t pid = fork();
    
    if (pid < 0) {
        close(stdin_pipe[0]); close(stdin_pipe[1]);
        close(stdout_pipe[0]); close(stdout_pipe[1]);
        close(stderr_pipe[0]); close(stderr_pipe[1]);
        result.killed_by = "internal_error";
        return result;
    }
    
    if (pid == 0) {
        close(stdin_pipe[1]);
        close(stdout_pipe[0]);
        close(stderr_pipe[0]);
        
        dup2(stdin_pipe[0], STDIN_FILENO);
        dup2(stdout_pipe[1], STDOUT_FILENO);
        dup2(stderr_pipe[1], STDERR_FILENO);
        
        close(stdin_pipe[0]);
        close(stdout_pipe[1]);
        close(stderr_pipe[1]);
        
        if (config.mem_mb > 0) {
            rlimit rl;
            rl.rlim_cur = config.mem_mb * 1024 * 1024;
            rl.rlim_max = config.mem_mb * 1024 * 1024;
            setrlimit(RLIMIT_AS, &rl);
        }
        
        if (config.cpu_ms > 0) {
            rlimit rl;
            rl.rlim_cur = config.cpu_ms / 1000 + (config.cpu_ms % 1000 > 0 ? 1 : 0);
            // Soft limit raises SIGXCPU (classifiable as cpu_timeout); hard limit
            // one second later SIGKILLs as a backstop if the handler is ignored.
            rl.rlim_max = rl.rlim_cur + 1;
            setrlimit(RLIMIT_CPU, &rl);
        }
        
        std::vector<char*> argv;
        argv.push_back(const_cast<char*>(config.exe.c_str()));
        for (const auto& arg : config.args) {
            argv.push_back(const_cast<char*>(arg.c_str()));
        }
        argv.push_back(nullptr);
        
        if (!config.cwd.empty()) {
            chdir(config.cwd.c_str());
        }
        
        execvp(config.exe.c_str(), argv.data());
        _exit(127);
    }
    
    close(stdin_pipe[0]);
    
    if (!config.stdin_file.empty()) {
        std::ifstream infile(config.stdin_file);
        std::stringstream buffer;
        buffer << infile.rdbuf();
        std::string content = buffer.str();
        
        size_t written = 0;
        while (written < content.size()) {
            ssize_t n = write(stdin_pipe[1], content.c_str() + written, content.size() - written);
            if (n <= 0) break;
            written += n;
        }
    }
    
    close(stdin_pipe[1]);
    
    std::atomic<bool> monitoring(true);
    std::thread monitor_thread([pid, &monitoring, &process_killed, config, &result]() {
        auto start = std::chrono::high_resolution_clock::now();
        while (monitoring.load() && !process_killed.load()) {
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::high_resolution_clock::now() - start).count();
            
            if (elapsed >= static_cast<int64_t>(config.wall_ms)) {
                kill(pid, SIGKILL);
                result.killed_by = "wall_timeout";
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    });
    
    std::ostringstream stdout_buffer;
    std::ostringstream stderr_buffer;
    
    close(stdout_pipe[1]);
    close(stderr_pipe[1]);
    
    fcntl(stdout_pipe[0], F_SETFL, O_NONBLOCK);
    fcntl(stderr_pipe[0], F_SETFL, O_NONBLOCK);
    
    bool stdout_done = false;
    bool stderr_done = false;
    uint64_t output_cap_bytes = config.stdout_cap_kb * 1024;
    int wstatus = 0;
    
    while (!stdout_done || !stderr_done) {
        struct pollfd pfd[2];
        int npfd = 0;
        
        if (!stdout_done) {
            pfd[npfd].fd = stdout_pipe[0];
            pfd[npfd].events = POLLIN;
            npfd++;
        }
        if (!stderr_done) {
            pfd[npfd].fd = stderr_pipe[0];
            pfd[npfd].events = POLLIN;
            npfd++;
        }
        
        if (npfd == 0) break;
        
        int ret = poll(pfd, npfd, 100);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (ret == 0) continue;
        
        for (int i = 0; i < npfd; i++) {
            int fd = pfd[i].fd;
            char buf[4096];
            ssize_t n = read(fd, buf, sizeof(buf) - 1);
            
            if (n > 0) {
                if (fd == stdout_pipe[0]) {
                    stdout_buffer.write(buf, n);
                    
                    if (static_cast<uint64_t>(stdout_buffer.tellp()) >= output_cap_bytes) {
                                                kill(pid, SIGKILL);
                        result.killed_by = "output_cap";
                        process_killed.store(true);
                        int wstatus2;
                        waitpid(pid, &wstatus2, 0);
                        stdout_done = true;
                        stderr_done = true;
                        break;
                    }
                } else if (fd == stderr_pipe[0]) {
                    stderr_buffer.write(buf, n);
                }
            } else if (n == 0) {
                if (fd == stdout_pipe[0]) stdout_done = true;
                else if (fd == stderr_pipe[0]) stderr_done = true;
            } else {
                if (errno != EINTR && errno != EWOULDBLOCK) {
                    if (fd == stdout_pipe[0]) stdout_done = true;
                    else if (fd == stderr_pipe[0]) stderr_done = true;
                }
            }
        }
    }
    
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);
    
    // Child should already be dead from poll loop kill or wall timeout
    monitoring.store(false);
    if (monitor_thread.joinable()) {
        monitor_thread.join();
    }
    
    // Reap the child process to get exit status
    waitpid(pid, &wstatus, WNOHANG);
    
    auto end_time = std::chrono::high_resolution_clock::now();
    result.wall_ms = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time).count());
    
    if (WIFEXITED(wstatus)) {
        result.exit_code = WEXITSTATUS(wstatus);
    } else if (WIFSIGNALED(wstatus)) {
        int sig = WTERMSIG(wstatus);
        
        if (result.killed_by.empty()) {
            switch (sig) {
                case SIGXCPU:
                    result.killed_by = "cpu_timeout";
                    break;
                case SIGKILL: {
                    // SIGKILL is ambiguous: the RLIMIT_CPU hard limit and the OOM
                    // killer both use it. Consult consumed CPU time to tell them apart.
                    struct rusage kru;
                    getrusage(RUSAGE_CHILDREN, &kru);
                    uint64_t used_cpu_ms =
                        kru.ru_utime.tv_sec * 1000 + kru.ru_utime.tv_usec / 1000 +
                        kru.ru_stime.tv_sec * 1000 + kru.ru_stime.tv_usec / 1000;
                    // 100ms slack: rusage ticks can land just under the whole-second
                    // granularity the kernel enforces (e.g. 998ms vs a 1000ms config).
                    if (config.cpu_ms > 0 && used_cpu_ms + 100 >= config.cpu_ms) {
                        result.killed_by = "cpu_timeout";
                    } else {
                        result.killed_by = "memory";
                    }
                    break;
                }
                default:
                    if (sig == SIGSEGV) {
                        result.killed_by = "sigsegv";
                    }
                    break;
            }
        }
        
        std::string stderr_str = stderr_buffer.str();
        if (result.killed_by.empty() && stderr_str.find("bad_alloc") != std::string::npos) {
            result.killed_by = "memory";
        }
    }
    
    struct rusage ru;
    getrusage(RUSAGE_CHILDREN, &ru);
    uint64_t elapsed_wall_ms = result.wall_ms;  // Save wall time before convert_rusage overwrites it
    convert_rusage(ru, result.wall_ms, result.cpu_ms);
    // restore actual wall clock time (convert_rusage sets it to CPU time)
    result.wall_ms = elapsed_wall_ms;
    
    std::ostringstream json_out;
    json_out << "{\"exit_code\":" << result.exit_code 
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
    
    // Print captured stdout first (may be truncated by cap)
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
