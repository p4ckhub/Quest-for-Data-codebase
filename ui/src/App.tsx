
import React, { useEffect } from "react";
import "./styles.css";
import { useGameStore } from "./store";
import { TitleScreen } from "./components/TitleScreen";
import { CharacterCreationScreen } from "./components/CharacterCreationScreen";
import { WorldMapScreen } from "./components/WorldMapScreen";
import { SandpitScreen } from "./components/SandpitScreen";
import LessonRunnerScreen from "./components/LessonRunner";
import CombatScreen from "./components/CombatScreen";
import { SpellbookScreen } from "./components/SpellbookScreen";
import { InventoryScreen } from "./components/InventoryScreen";
import { SettingsScreen } from "./components/SettingsScreen";

function App() {
  const screen = useGameStore((state) => state.screen);
  const setScreen = useGameStore((state) => state.setScreen);
  const loadZoneGraph = useGameStore((state) => state.loadZoneGraph);
  const loadSandpit = useGameStore((state) => state.loadSandpit);

  useEffect(() => {
    loadZoneGraph();
    loadSandpit();
  }, []);

  const renderScreen = () => {
    switch (screen) {
      case "title":
      case "save-select":
        return <TitleScreen onNewGame={() => setScreen("character-creation")} onSettings={() => setScreen("settings")} />;
      case "character-creation":
        return <CharacterCreationScreen />;
      case "sandpit":
        return <SandpitScreen />;
      case "world-map":
        return <WorldMapScreen />;
      case "lesson-encounter":
        return <LessonRunnerScreen />;
      case "combat":
        return <CombatScreen />;
      case "spellbook":
        return <SpellbookScreen />;
      case "inventory":
        return <InventoryScreen />;
      case "settings":
        return <SettingsScreen />;
      default:
        return null;
    }
  };

  return (
    <div className="app">
      {renderScreen()}
    </div>
  );
}

export default App;
