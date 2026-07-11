#ifndef MONSTERS_H
#define MONSTERS_H

#include <string>
#include <map>
#include <memory>
#include <functional>

// The Monster base class the Bestiary (Zone 7) teaches against.
// Player lessons subclass this; the combat harness fights any subclass through
// virtual dispatch with byte-identical harness code (§11.5).
class Monster {
public:
    virtual ~Monster() = default;

    // The species name shown in combat logs.
    virtual std::string species() const = 0;

    // Damage roll for this monster's turn.
    virtual int attack() = 0;

    // Starting hit points for a fresh instance of this monster.
    virtual int max_hp() const { return 30; }

    // Called when the monster takes damage (hook for special behavior).
    virtual void on_hit(int /*amount*/) {}
};

using MonsterFactory = std::function<std::unique_ptr<Monster>()>;

inline std::map<std::string, MonsterFactory>& monster_registry() {
    static std::map<std::string, MonsterFactory> registry;
    return registry;
}

inline bool register_monster(const std::string& type, MonsterFactory factory) {
    monster_registry()[type] = std::move(factory);
    return true;
}

// Epilogues register player-authored monsters with this; the harness only ever
// looks types up in the registry, never names a concrete subclass.
#define REGISTER_MONSTER(TYPE_STR, CLASS) \
    static bool _monster_reg_##CLASS = register_monster(TYPE_STR, [] { \
        return std::unique_ptr<Monster>(new CLASS()); \
    });

#endif // MONSTERS_H
