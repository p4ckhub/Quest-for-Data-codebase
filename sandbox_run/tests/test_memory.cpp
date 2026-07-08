#include <windows.h>
#include <cstdio>
#include <cstdlib>

int main() {
    // Memory exhaustion - allocate unbounded memory
    while (1) {
        void* ptr = VirtualAlloc(nullptr, 1024 * 1024, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
        if (!ptr) break;
        *(char*)ptr = 1;  // Touch the page
    }
    return 0;
}
