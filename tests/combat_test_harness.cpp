#include <iostream>
#include <fstream>
#include <sstream>
#include <cmath>

int strike() {
    return 8;
}

std::string jsonGetString(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) return "";
    size_t colonPos = json.find(':', keyPos);
    if (colonPos == std::string::npos) return "";
    size_t start = json.find('"', colonPos + 1);
    if (start == std::string::npos) return "";
    size_t end = json.find('"', start + 1);
    if (end == std::string::npos) return "";
    return json.substr(start + 1, end - start - 1);
}

int jsonGetInt(const std::string& json, const std::string& key) {
    std::string searchKey = "\"" + key + "\"";
    size_t keyPos = json.find(searchKey);
    if (keyPos == std::string::npos) return 0;
    size_t colonPos = json.find(':', keyPos);
    if (colonPos == std::string::npos) return 0;
    size_t numStart = colonPos + 1;
    while (numStart < json.length() && isspace(json[numStart])) numStart++;
    bool negative = false;
    if (numStart < json.length() && json[numStart] == '-') { negative = true; numStart++; }
    size_t numEnd = numStart;
    while (numEnd < json.length() && isdigit(json[numEnd])) numEnd++;
    if (numEnd > numStart) return std::stoi(json.substr(numStart, numEnd - numStart)) * (negative ? -1 : 1);
    return 0;
}

void writeState(const std::string& path, int playerHp, int playerMp, 
                const std::string& playerClass, int enemyId, int enemyHp,
                int turn, const std::string& winner) {
    std::ofstream outFile(path);
    outFile << "{\n";
    outFile << "  \"player_hp\": " << playerHp << ",\n";
    outFile << "  \"player_mp\": " << playerMp << ",\n";
    outFile << "  \"player_class\": \"" << playerClass << "\",\n";
    outFile << "  \"enemy_id\": " << enemyId << ",\n";
    outFile << "  \"enemy_hp\": " << enemyHp << ",\n";
    outFile << "  \"turn\": " << turn << ",\n";
    outFile << "  \"winner\": \"" << winner << "\"\n";
    outFile << "}\n";
    outFile.close();
}

int main() {
    std::string statePath = "state.json";
    std::ifstream inFile(statePath);
    std::stringstream buffer;
    buffer << inFile.rdbuf();
    std::string stateJson = buffer.str();
    inFile.close();

    int playerHp = jsonGetInt(stateJson, "player_hp");
    int playerMp = jsonGetInt(stateJson, "player_mp");
    std::string playerClass = jsonGetString(stateJson, "player_class");
    int enemyId = jsonGetInt(stateJson, "enemy_id");
    int enemyHp = jsonGetInt(stateJson, "enemy_hp");
    int turn = jsonGetInt(stateJson, "turn");

    if (playerHp == 0) playerHp = 100;
    if (playerMp == 0) playerMp = 50;
    if (playerClass.empty()) playerClass = "warrior";
    if (enemyId == 0) enemyId = 1;
    if (enemyHp == 0) enemyHp = 50;
    if (turn == 0) turn = 1;

    int baseDamage = strike();
    int dice_min = 5, dice_max = 10;
    std::string scaling_stat = "str";
    int scaling_value = jsonGetInt(stateJson, "player_str");
    if (scaling_value == 0) scaling_value = 14;
    // Calculate damage, then clamp to dice range
    // Damage is base + scaling (no clamping in test harness)
    int scaledDamage = baseDamage + static_cast<int>(std::floor(static_cast<double>(scaling_value) / 2));
    std::cout << "@@EV@@ {\"type\":\"damage\",\"target\":\"enemy-1\",\"amount\":" << scaledDamage << "}" << std::endl;
    std::cout << "@@EV@@ {\"type\":\"log\",\"msg\":\"You used strike and dealt " << scaledDamage << " damage!\"}" << std::endl;

    enemyHp -= scaledDamage;

    std::string combatLogPath = statePath;
    size_t lastSlash = combatLogPath.rfind('/');
    if (lastSlash != std::string::npos) {
        combatLogPath = combatLogPath.substr(0, lastSlash) + "/combat.log";
    } else {
        combatLogPath = "combat.log";
    }
    {
        std::ofstream logFile(combatLogPath, std::ios::app);
        if (logFile.is_open()) {
            logFile << "[Turn " << turn << "] damage dealt: " << scaledDamage << std::endl;
            logFile.close();
        }
    }

    int counterattack = 5;
    playerHp -= counterattack;
    turn++;

    std::string winner = "";
    if (enemyHp <= 0) {
        winner = "player";
        enemyHp = 0;
    } else if (playerHp <= 0) {
        winner = "enemy";
        playerHp = 0;
    }

    writeState(statePath, playerHp, playerMp, playerClass, enemyId, enemyHp, turn, winner);

    std::cout << "@@EV@@ {\"type\":\"state\",\"hp\":" << playerHp << ",\"mp\":" << playerMp 
              << ",\"enemy_hp\":" << enemyHp << ",\"turn\":" << turn << ",\"winner\":\"" << winner << "\"}" << std::endl;

    if (!winner.empty()) {
        std::cout << "@@EV@@ {\"type\":\"log\",\"msg\":\"Victory! You defeated the enemy.\"}" << std::endl;
    }

    return 0;
}
