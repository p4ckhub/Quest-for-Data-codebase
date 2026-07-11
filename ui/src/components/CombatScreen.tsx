import React, { useEffect, useRef, useState } from "react";
import { useGameStore } from "../store";
import CombatScene from "./CombatScene";

// Screen-level combat driver: starts a session via combat:start, sends the
// equipped spell as the action each CAST, renders harness events through
// CombatScene, and applies rewards on victory. No combat math happens here —
// the C++ harness owns the numbers (§11.5).

const CombatScreen: React.FC = () => {
  const {
    player,
    save,
    currentZoneId,
    currentEncounterId,
    setScreen,
    completeBoss,
    equippedSpell,
    reducedMotion,
    animationSpeed,
  } = useGameStore();

  const [combatState, setCombatState] = useState<any>(null);
  const [encounter, setEncounter] = useState<any>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rewarded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!player || !currentEncounterId) return;
      const result = await window.gameapi.combat.start({
        playerClass: player.class,
        encounterId: currentEncounterId,
        spells: save?.spellbook ?? [],
      });
      if (cancelled) return;
      if (result?.success) {
        setCombatState(result.state);
        setEncounter(result.encounter);
        setLog([result.encounter?.description?.trim() || "The enemy bars your way."]);
      } else {
        setError(result?.error ?? "Failed to start combat");
      }
    };
    start();
    return () => {
      cancelled = true;
      window.gameapi?.combat?.end?.();
    };
  }, [currentEncounterId]);

  const handleTurn = async () => {
    const spell = equippedSpell();
    if (!spell) {
      setLog((prev) => [...prev, "You have no forged spell equipped — visit the Spellbook."]);
      return;
    }
    setBusy(true);
    try {
      const result = await window.gameapi.combat.turn({ action: spell.name });
      if (result?.success && result.state) {
        setCombatState(result.state);
        const msgs = (result.events ?? [])
          .filter((e: any) => e.type === "log" && e.msg)
          .map((e: any) => e.msg as string);
        setLog((prev) => [...prev, ...msgs].slice(-12));

        if (result.state.winner === "player" && !rewarded.current && currentZoneId) {
          rewarded.current = true;
          await completeBoss(currentZoneId, encounter?.xp_reward ?? 100);
        }
      } else if (result?.error) {
        setError(result.error);
      }
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="combat-screen">
        <p className="combat-error">{error}</p>
        <button className="btn" onClick={() => setScreen("world-map")}>Back to World Map</button>
      </div>
    );
  }

  if (!combatState || !player) {
    return <div className="combat-screen"><p>Entering the arena...</p></div>;
  }

  const enemy = combatState.enemies?.[0] ?? { id: "enemy-1", type: "monster", hp: 0, max_hp: 1 };
  const winner = combatState.winner;
  const sceneState =
    winner === "player" ? "victory" : winner === "enemy" ? "defeat" : "player-turn";

  return (
    <div className="combat-screen" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <CombatScene
          player={{
            hp: combatState.player.hp,
            mp: combatState.player.mp,
            maxHp: combatState.player.max_hp ?? combatState.player.hp,
            maxMp: combatState.player.max_mp ?? combatState.player.mp,
            class: player.class,
            level: player.level,
          }}
          enemy={{
            id: 1,
            name: encounter?.name ?? enemy.type,
            hp: enemy.hp,
            maxHp: enemy.max_hp,
          }}
          turn={combatState.turn}
          combatState={sceneState}
          reducedMotion={reducedMotion}
          animationSpeed={animationSpeed}
          onCombatTurn={handleTurn}
        />
      </div>

      <div className="combat-log" style={{ maxHeight: "20%", overflowY: "auto", padding: "0.5rem 1rem", background: "#16162e", fontSize: "0.9rem" }}>
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "1rem", padding: "0.5rem 1rem", background: "#16162e" }}>
        {!winner && (
          <button className="btn cast-btn" onClick={handleTurn} disabled={busy}>
            {busy ? "Casting..." : `CAST ${equippedSpell()?.name ?? ""}`}
          </button>
        )}
        {winner && (
          <button className="btn" onClick={() => setScreen("world-map")}>
            {winner === "player" ? "Claim Victory" : "Retreat and Recover"}
          </button>
        )}
        {!winner && (
          <button className="btn" onClick={() => setScreen("world-map")} disabled={busy}>
            Flee
          </button>
        )}
      </div>
    </div>
  );
};

export default CombatScreen;
