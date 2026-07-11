
import React, { useEffect, useState } from "react";
import { useGameStore } from "../store";
import classesData from "../../../content/classes.json";

interface ClassData {
  display_name: string;
  description: string;
  base_stats: { hp: number; mp: number; str: number; agi: number; int: number };
  starter_spell: { name: string; signature: string };
}

const CLASSES: Record<string, ClassData> = (classesData as any).classes;

export const CharacterCreationScreen: React.FC = () => {
  const newGame = useGameStore((s) => s.newGame);
  const setScreen = useGameStore((s) => s.setScreen);
  const [name, setName] = useState("");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [slot, setSlot] = useState<number>(1);
  const [occupied, setOccupied] = useState<Record<number, boolean>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const fetchSlots = async () => {
      const api = (window as any).gameapi;
      if (!api) return;
      const list = await api.saves.list();
      const occ: Record<number, boolean> = {};
      let firstFree = 0;
      for (const s of [1, 2, 3]) {
        occ[s] = !!list?.[s]?.exists;
        if (!occ[s] && firstFree === 0) firstFree = s;
      }
      setOccupied(occ);
      if (firstFree > 0) setSlot(firstFree);
    };
    fetchSlots();
  }, []);

  const handleCreate = async () => {
    if (!name || !selectedClass || creating) return;
    setCreating(true);
    try {
      await newGame(slot, name, selectedClass);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="char-screen">
      <h2>Create Your Character</h2>

      <input
        type="text"
        placeholder="Enter your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="class-selection">
        {Object.entries(CLASSES).map(([className, classData]) => (
          <div
            key={className}
            className={`class-card ${selectedClass === className ? "selected" : ""}`}
            onClick={() => setSelectedClass(className)}
          >
            <h3>{classData.display_name}</h3>
            <p>{classData.description}</p>
            <p className="class-stats">
              HP {classData.base_stats.hp} · MP {classData.base_stats.mp} · STR {classData.base_stats.str} · AGI {classData.base_stats.agi} · INT {classData.base_stats.int}
            </p>
            <p className="class-spell">Starter spell: {classData.starter_spell.name}</p>
          </div>
        ))}
      </div>

      <div className="slot-selection" style={{ margin: "1rem 0" }}>
        <label>
          Save to slot:{" "}
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {[1, 2, 3].map((s) => (
              <option key={s} value={s}>
                Slot {s}{occupied[s] ? " (overwrites existing save)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button className="btn" disabled={!name || !selectedClass || creating} onClick={handleCreate}>
        {creating ? "Awakening..." : "Create Character"}
      </button>
      <button className="btn" onClick={() => setScreen("title")}>Back</button>
    </div>
  );
};
