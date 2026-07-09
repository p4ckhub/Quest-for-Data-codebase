#include "gameapi.h"
#include "json.hpp"

using json = nlohmann::json;

static void emit_event(const json& ev) {
    json full = ev;
    full["v"] = 1;
    std::cout << "@@EV@@ " << full.dump() << std::endl;
}

namespace gameapi {

void log(const std::string& message) {
    emit_event(json{{"type", "log"}, {"msg", message}});
}

void set_stat(const std::string& name, double value) {
    emit_event(json{{"type", "stat_set"}, {"name", name}, {"value", value}});
}

void deal_damage(const std::string& target_id, int amount) {
    emit_event(json{{"type", "damage"}, {"target", target_id}, {"amount", amount}});
}

void heal(const std::string& target_id, int amount) {
    emit_event(json{{"type", "heal"}, {"target", target_id}, {"amount", amount}});
}

void add_item(const std::string& item_id, int count) {
    emit_event(json{{"type", "item_add"}, {"item", item_id}, {"count", count}});
}

void remove_item(const std::string& item_id, int count) {
    emit_event(json{{"type", "item_remove"}, {"item", item_id}, {"count", count}});
}

void cast_fx(const std::string& spell_name) {
    emit_event(json{{"type", "spell_cast"}, {"name", spell_name}});
}

void report(const std::string& check_id, double value) {
    emit_event(json{{"type", "check"}, {"id", check_id}, {"value", value}});
}

void report(const std::string& check_id, const std::string& value) {
    emit_event(json{{"type", "check"}, {"id", check_id}, {"value", value}});
}

} // namespace gameapi
