#include <cstdio>

// Recursive function to cause stack overflow
void recurse(int depth) {
    char buffer[4096];
    buffer[0] = depth % 256;
    recurse(depth + 1);
}

int main() {
    printf("Stack overflow test\n");
    recurse(0);
    return 0;
}
