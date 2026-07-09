#include <cstdio>
#include <unistd.h>

int main() {
    // Infinite loop - should be killed by wall timeout
    while (1) {
        sleep(1);
    }
    return 0;
}
