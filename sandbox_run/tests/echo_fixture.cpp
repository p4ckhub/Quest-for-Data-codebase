#include <cstdio>

int main() {
    char buffer[4096];
    if (fgets(buffer, sizeof(buffer), stdin)) {
        printf("%s", buffer);
    }
    return 0;
}
