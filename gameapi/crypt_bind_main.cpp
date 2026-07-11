// Crypt harness: Zone 9 lesson 1 (bind-the-spirit). Arms the leakcheck shim
// (§11.6) around the player-code section only, then reports both the computed
// result and the allocation ledger.
#include "gameapi.h"

int bind_spirit();  // player's function

// leakcheck.cpp (linked via the lesson's extra_units)
void leakcheck_arm();
void leakcheck_disarm();
long long leakcheck_allocs();
long long leakcheck_frees();
long long leakcheck_live_bytes();

int main() {
    leakcheck_arm();
    int power = bind_spirit();
    leakcheck_disarm();

    gameapi::report("power", power);
    gameapi::report("allocs", leakcheck_allocs());
    gameapi::report("live_bytes", leakcheck_live_bytes());

    if (leakcheck_live_bytes() > 0) {
        gameapi::log("Something unfreed stirs in the dark of the crypt...");
    } else {
        gameapi::log("Bound, drawn upon, released — the crypt stays quiet.");
    }
    return 0;
}
