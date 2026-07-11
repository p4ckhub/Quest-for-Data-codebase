#include "gameapi.h"

int base_force(); // Forward declare the player's functions
int empowered();

int main() {
    gameapi::report("base", base_force());
    gameapi::report("empowered", empowered());
    return 0;
}
