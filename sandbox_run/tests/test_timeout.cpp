#include <windows.h>
#include <cstdio>
#include <cstdlib>

int main() {
    // Infinite loop - should be killed by wall timeout
    while (1) {
        Sleep(10);
    }
    return 0;
}
