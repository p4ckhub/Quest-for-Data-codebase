// Combat harness (§11.5). One process run = one combat turn.
// Reads state.json from the working directory, resolves the turn entirely in
// C++ (the UI never simulates combat), emits events, writes state.json back.
//
// All numbers are data-driven from state.json — the runner injects the player's
// damage_formula from classes.json and each enemy's stats from encounter
// content. Nothing lesson- or class-specific is hardcoded here (guardrail #3).

#include "gameapi.h"
#include "monsters.h"
#include "spellbook.h"
#include "json.hpp"

#include <fstream>
#include <iostream>
#include <random>
#include <string>

using json = nlohmann::json;

static void emit(const json& ev) {
    json full = ev;
    full["v"] = 1;
    std::cout << "@@EV@@ " << full.dump() << std::endl;
}

static int rand_between(int lo, int hi) {
    static std::mt19937 rng{std::random_device{}()};
    if (hi < lo) std::swap(lo, hi);
    return std::uniform_int_distribution<int>(lo, hi)(rng);
}

int main(int argc, char* argv[]) {
    std::string action = "";
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--action" && i + 1 < argc) action = argv[++i];
    }

    std::ifstream in("state.json");
    if (!in.is_open()) {
        emit({{"type", "log"}, {"msg", "The arena is silent — no combat state found."}});
        return 1;
    }
    json state;
    try {
        in >> state;
    } catch (const std::exception& e) {
        emit({{"type", "log"}, {"msg", std::string("Combat state unreadable: ") + e.what()}});
        return 1;
    }
    in.close();

    json& player = state["player"];
    json& enemies = state["enemies"];
    int turn = state.value("turn", 1);

    // ---- Leak-monster growth (§11.6): applied at turn start, formula fields
    // come from content via the runner, never hardcoded here.
    for (auto& enemy : enemies) {
        long leak_bytes = enemy.value("leak_bytes", 0L);
        int grow_hp = enemy.value("grow_hp_per_turn", 0);
        if (leak_bytes > 0 && grow_hp > 0 && enemy.value("hp", 0) > 0) {
            enemy["hp"] = enemy.value("hp", 0) + grow_hp;
            emit({{"type", "log"},
                  {"msg", enemy.value("type", std::string("monster")) +
                              " swells with unreclaimed aether! (+" + std::to_string(grow_hp) + " HP)"}});
        }
    }

    // ---- Player action: cast the named spell from the Spellbook.
    json formula = player.value("damage_formula", json::object());
    int dice_min = formula.value("dice_min", 1);
    int dice_max = formula.value("dice_max", 6);
    int scaling_div = formula.value("scaling_div", 2);
    int mp_cost = formula.value("mp_cost", 0);
    std::string scaling_stat = formula.value("scaling_stat", "str");
    int stat_value = player.value(scaling_stat, 0);

    bool acted = false;
    if (!action.empty() && player.value("hp", 0) > 0) {
        if (player.value("mp", 0) < mp_cost) {
            emit({{"type", "log"}, {"msg", "Not enough aether to cast " + action + "."}});
        } else {
            bool found = false;
            int roll = spellbook_cast(action, found);
            if (!found) {
                emit({{"type", "log"}, {"msg", "You have not forged a spell named '" + action + "'."}});
            } else {
                // §5.1: spell return value clamped to dice range, scaling added after.
                int clamped = std::max(dice_min, std::min(dice_max, roll));
                int damage = clamped + stat_value / scaling_div;
                player["mp"] = player.value("mp", 0) - mp_cost;

                emit({{"type", "spell_cast"}, {"name", action}});

                // Target: first living enemy.
                for (auto& enemy : enemies) {
                    if (enemy.value("hp", 0) <= 0) continue;
                    enemy["hp"] = std::max(0, enemy.value("hp", 0) - damage);
                    emit({{"type", "damage"}, {"target", enemy.value("id", std::string("enemy"))}, {"amount", damage}});
                    emit({{"type", "log"},
                          {"msg", "Your " + action + " strikes " + enemy.value("type", std::string("the enemy")) +
                                      " for " + std::to_string(damage) + " damage!"}});
                    if (enemy.value("hp", 0) <= 0) {
                        emit({{"type", "log"}, {"msg", enemy.value("type", std::string("The enemy")) + " is destroyed!"}});
                    }
                    acted = true;
                    break;
                }
            }
        }
    }

    // ---- Enemy turns: registry-driven for player-authored monsters (§11.5),
    // data-driven attack ranges for content monsters. Identical code for every
    // monster type — the harness never names a concrete subclass.
    for (auto& enemy : enemies) {
        if (enemy.value("hp", 0) <= 0) continue;
        if (player.value("hp", 0) <= 0) break;

        std::string type = enemy.value("type", "");
        int damage = 0;

        auto it = monster_registry().find(type);
        if (it != monster_registry().end()) {
            std::unique_ptr<Monster> m = it->second();
            damage = m->attack();
        } else {
            json atk = enemy.value("attack", json::object());
            damage = rand_between(atk.value("min", 1), atk.value("max", 4));
        }

        player["hp"] = std::max(0, player.value("hp", 0) - damage);
        emit({{"type", "damage"}, {"target", "player"}, {"amount", damage}});
        emit({{"type", "log"},
              {"msg", type + " retaliates for " + std::to_string(damage) + " damage!"}});
    }

    // ---- Resolve turn.
    state["turn"] = turn + 1;

    bool all_enemies_dead = true;
    for (const auto& enemy : enemies) {
        if (enemy.value("hp", 0) > 0) all_enemies_dead = false;
    }
    if (all_enemies_dead) {
        state["winner"] = "player";
        emit({{"type", "log"}, {"msg", "Victory! The way forward is clear."}});
    } else if (player.value("hp", 0) <= 0) {
        state["winner"] = "enemy";
        emit({{"type", "log"}, {"msg", "You collapse — the incantation fades from your fingers..."}});
    } else {
        state["winner"] = nullptr;
    }

    std::ofstream out("state.json");
    out << state.dump(2) << std::endl;
    out.close();

    emit({{"type", "state"}, {"state", state}});
    (void)acted;
    return 0;
}
