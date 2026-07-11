#include "gameapi.h"

int choose_gate(int omen); // Forward declare the player's function

int main() {
    // The Crossroads casts an omen; the player's doctrine decides the road.
    int gate = choose_gate(7);
    gameapi::report("gate_choice", gate);
    if (gate == 1) {
        gameapi::log("The Gate of Valor grinds open. The war-road remembers you.");
    } else if (gate == 2) {
        gameapi::log("The Gate of Cunning slides aside. The shadow-road remembers you.");
    } else {
        gameapi::log("Your answer echoes off dead stone. Neither gate stirs.");
    }
    return 0;
}
