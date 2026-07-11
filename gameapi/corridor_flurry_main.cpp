#include "gameapi.h"

int flurry(); // Forward declare the player's function

int main() {
    int total = flurry();
    gameapi::report("flurry_total", total);
    if (total == 12) {
        gameapi::log("Three strikes land as one. The Flurry is forged.");
    } else {
        gameapi::log("The strikes scatter — the Flurry is not yet true.");
    }
    return 0;
}
