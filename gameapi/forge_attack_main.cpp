#include "gameapi.h"
#include <algorithm>

int strike(); // Forward declare the player's function

int main() {
    int min_damage = 100, max_damage = 0;
    for (int i = 0; i < 200; ++i) {
        int damage = strike();
        min_damage = std::min(min_damage, damage);
        max_damage = std::max(max_damage, damage);
    }
    gameapi::report("min_damage", min_damage);
    gameapi::report("max_damage", max_damage);
    return 0;
}
