// Crypt harness: Zone 9 lesson 3 (the-unbreakable-binding). Arms the
// leakcheck shim (§11.6) around the player-code section only — a smart
// pointer must leave nothing live without a single manual delete.
#include "gameapi.h"

int bind_companion();  // player's function

// leakcheck.cpp (linked via the lesson's extra_units)
void leakcheck_arm();
void leakcheck_disarm();
long long leakcheck_allocs();
long long leakcheck_frees();
long long leakcheck_live_bytes();

int main() {
    leakcheck_arm();
    int strength = bind_companion();
    leakcheck_disarm();

    gameapi::report("strength", strength);
    gameapi::report("allocs", leakcheck_allocs());
    gameapi::report("live_bytes", leakcheck_live_bytes());

    if (leakcheck_live_bytes() > 0) {
        gameapi::log("The binding slipped — aether leaks from the companion's tether.");
    } else {
        gameapi::log("The companion walks beside you, bound by a pointer that cannot forget.");
    }
    return 0;
}
