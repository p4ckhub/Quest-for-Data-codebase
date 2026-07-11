// Crypt harness: Zone 9 lesson 2 (seal-the-rift). Arms the leakcheck shim
// (§11.6) around the player-code section only. Unfreed bytes here are what
// feed the Leak monster: the report below is the lesson's verdict.
#include "gameapi.h"

int seal_the_rift();  // player's function

// leakcheck.cpp (linked via the lesson's extra_units)
void leakcheck_arm();
void leakcheck_disarm();
long long leakcheck_allocs();
long long leakcheck_frees();
long long leakcheck_live_bytes();

int main() {
    leakcheck_arm();
    int total = seal_the_rift();
    leakcheck_disarm();

    gameapi::report("total", total);
    gameapi::report("allocs", leakcheck_allocs());
    gameapi::report("frees", leakcheck_frees());
    gameapi::report("live_bytes", leakcheck_live_bytes());

    if (leakcheck_live_bytes() > 0) {
        gameapi::log("The rift still weeps — unreclaimed aether pools on the crypt floor.");
    } else {
        gameapi::log("Every summoned shard returned to the world. The rift is sealed.");
    }
    return 0;
}
