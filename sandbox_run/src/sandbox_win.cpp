#include <windows.h>
#include <cstdio>

// Windows Job Object implementation (placeholder for Phase 1)
// This stub is not used in Phase 0 which is Linux-only

#include "sandbox.h"

RunResult run_sandboxed(const RunConfig& config) {
    fprintf(stderr, "sandbox_run: Windows implementation not yet available\n");
    RunResult result{127, 0, 0, "internal_error"};
    std::cout << "@@RESULT@@ {\"exit_code\":127,\"wall_ms\":0,\"cpu_ms\":0,\"killed_by\":\"internal_error\"}" << std::endl;
    return result;
}
