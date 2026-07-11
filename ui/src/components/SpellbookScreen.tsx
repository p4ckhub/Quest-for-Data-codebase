
import React from "react";
import { useGameStore } from "../store";

// Spellbook (§9.1 screen 5): a visualization of the save's spellbook data
// plus equip toggles — not a separate progression system (§11.8).

export const SpellbookScreen: React.FC = () => {
  const { save, setScreen, persistSave } = useGameStore();
  const spells = save?.spellbook ?? [];

  const handleEquip = async (lessonId: string) => {
    if (!save) return;
    for (const spell of save.spellbook) {
      spell.equipped = spell.lesson_id === lessonId;
    }
    useGameStore.setState({ save: { ...save } });
    await persistSave();
  };

  return (
    <div className="spell-screen">
      <h2>Spellbook</h2>
      {spells.length === 0 && (
        <p>No spells forged yet — the Function Forge awaits.</p>
      )}
      <div className="spells-grid">
        {spells.map((spell) => (
          <div key={spell.lesson_id} className={`spell-card ${spell.equipped ? "equipped" : ""}`} style={{ border: spell.equipped ? "2px solid #e94560" : "1px solid #333", borderRadius: 8, padding: "1rem" }}>
            <h3>{spell.name}</h3>
            <code>{spell.signature}</code>
            <pre className="spell-source" style={{ fontSize: "0.75rem", maxHeight: 120, overflow: "auto", background: "#10102a", padding: "0.5rem" }}>{spell.source}</pre>
            <button className="btn" disabled={spell.equipped} onClick={() => handleEquip(spell.lesson_id)}>
              {spell.equipped ? "Equipped" : "Equip"}
            </button>
          </div>
        ))}
      </div>
      <button className="btn" onClick={() => setScreen("world-map")}>Back</button>
    </div>
  );
};
