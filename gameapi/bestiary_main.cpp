// Bestiary lesson harness (§11.5). This file is byte-identical for every
// player-authored Monster subclass: it speaks to the beast only through the
// base Monster interface, found via the registry — it never names a concrete
// subclass. Phase 3 acceptance verifies two different subclasses fight
// correctly through this exact file with zero changes.
#include "gameapi.h"
#include "monsters.h"

#include <algorithm>

int main() {
    auto& registry = monster_registry();
    gameapi::report("registered", registry.size());
    if (registry.empty()) {
        gameapi::log("The summoning circle stands empty — no form answered.");
        return 0;
    }

    auto& entry = *registry.begin();
    std::unique_ptr<Monster> beast = entry.second();

    gameapi::report("type", entry.first);
    gameapi::report("species", beast->species());
    gameapi::report("max_hp", beast->max_hp());

    // Five attack rounds through virtual dispatch.
    int total = 0, lo = 0, hi = 0;
    for (int round = 0; round < 5; ++round) {
        int roll = beast->attack();
        if (round == 0) { lo = roll; hi = roll; }
        lo = std::min(lo, roll);
        hi = std::max(hi, roll);
        total += roll;
    }
    gameapi::report("attack_total", total);
    gameapi::report("attack_min", lo);
    gameapi::report("attack_max", hi);

    // Strike the beast and let its on_hit hook react, then read one more attack.
    beast->on_hit(10);
    gameapi::report("post_hit_attack", beast->attack());

    gameapi::log("The " + beast->species() +
                 " answers the circle through the base Monster alone.");
    return 0;
}
