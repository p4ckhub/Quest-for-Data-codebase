#include <cstdio>
#include <cstdlib>
#include <unistd.h>

int main() {
    // Memory exhaustion - allocate unbounded memory
    while (1) {
        void* ptr = malloc(1024 * 1024);
        if (!ptr) break;
        *(char*)ptr = 1;  // Touch the page
        free(ptr);  // Free and continue to trigger OOM condition
    }
    return 0;
}
