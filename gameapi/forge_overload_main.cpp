#include "gameapi.h"
#include <algorithm>

int attack();  // Forward declare the player's functions
int attack(int fury);

int main() {
    int min_damage = 100, max_damage = 0;
    for (int i = 0; i < 200; ++i) {
        // Test both overloads
        int damage1 = attack();
        int damage2 = attack(7);
        int damage = std::min(damage1, damage2);
        min_damage = std::min(min_damage, damage);
        max_damage = std::max(max_damage, damage);
    }
    gameapi::report("min_damage", min_damage);
    gameapi::report("max_damage", max_damage);
    return 0;
}
