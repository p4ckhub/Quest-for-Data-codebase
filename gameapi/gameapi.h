#ifndef GAMEAPI_H
#define GAMEAPI_H

#include <string>
#include <iostream>
#include <cstdio>

namespace gameapi {

// v1.0 API (add to this as Act 1 zones come online)
void log(const std::string& message);
void set_stat(const std::string& name, double value);
void deal_damage(const std::string& target_id, int amount);
void heal(const std::string& target_id, int amount);
void add_item(const std::string& item_id, int count);
void remove_item(const std::string& item_id, int count);
void cast_fx(const std::string& spell_name);
void report(const std::string& check_id, double value);
void report(const std::string& check_id, const std::string& value);

} // namespace gameapi

#endif
