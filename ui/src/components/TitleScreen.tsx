import React, { useEffect, useState } from "react";
import { useGameStore } from "../store";

interface TitleScreenProps {
  onNewGame: () => void;
  onSettings: () => void;
}

interface SlotInfo {
  exists: boolean;
  corrupted?: boolean;
  player?: { name: string; class: string; level: number };
}

export const TitleScreen: React.FC<TitleScreenProps> = ({ onNewGame, onSettings }) => {
  const loadGame = useGameStore((s) => s.loadGame);
  const [slots, setSlots] = useState<Record<number, SlotInfo>>({});

  useEffect(() => {
    const fetchSlots = async () => {
      const api = (window as any).gameapi;
      if (!api) return;
      const list = await api.saves.list();
      const enriched: Record<number, SlotInfo> = {};
      for (const slot of [1, 2, 3]) {
        enriched[slot] = list?.[slot] ?? { exists: false };
        if (enriched[slot].exists && !enriched[slot].corrupted) {
          const loaded = await api.saves.load(slot);
          if (loaded?.success) enriched[slot].player = loaded.data.player;
        }
      }
      setSlots(enriched);
    };
    fetchSlots();
  }, []);

  const handleSlotClick = async (slot: number) => {
    const info = slots[slot];
    if (!info?.exists || info.corrupted) return;
    await loadGame(slot);
  };

  return (
    <div className="title-screen">
      <h1 className="title-logo">Quest for Data</h1>
      <button className="btn" onClick={onNewGame}>New Game</button>
      {[1, 2, 3].map((slot) => {
        const info = slots[slot];
        const label = info?.corrupted
          ? `Slot ${slot}: Corrupted (backed up)`
          : info?.player
            ? `Slot ${slot}: ${info.player.name} — ${info.player.class}, Lv ${info.player.level}`
            : `Slot ${slot}: Empty`;
        return (
          <div
            key={slot}
            className={`save-slot ${info?.player ? "active" : ""}`}
            onClick={() => handleSlotClick(slot)}
            style={{ cursor: info?.player ? "pointer" : "default", opacity: info?.player ? 1 : 0.6 }}
          >
            {label}
          </div>
        );
      })}
      <button className="btn" onClick={onSettings}>Settings</button>
    </div>
  );
};
