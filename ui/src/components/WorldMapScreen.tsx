
import React, { useState, useEffect } from "react";
import { useGameStore, ZoneInfo } from "../store";

// World map (§9.1 screen 3): zone nodes from the content-driven zone graph,
// states derived from the save. Clicking an available zone opens its lesson
// list; the boss entry appears once all lessons are passed.

export const WorldMapScreen: React.FC = () => {
  const { zoneGraph, save, player, setScreen, selectLesson, startEncounter, zoneStatus, sandpitComplete, currentZoneId, openCodex } = useGameStore();
  // Reopen the zone the player just came from (Back/Continue from a lesson)
  // instead of always collapsing to the top of the zone list.
  const [openZone, setOpenZone] = useState<string | null>(currentZoneId ?? null);

  // The world stays out of reach until the sandpit's mandatory lessons are
  // done (PHASE1.5 §2) — a save mid-tutorial gets sent back
  const gated = !!save && !sandpitComplete();
  useEffect(() => {
    if (gated) setScreen("sandpit");
  }, [gated]);
  if (gated) return null;

  const lessonStatus = (zoneId: string, lessonId: string): string =>
    save?.zones[zoneId]?.lessons[lessonId]?.status ?? "available";

  const allLessonsPassed = (zone: ZoneInfo): boolean =>
    zone.lessons.length > 0 && zone.lessons.every((l) => lessonStatus(zone.id, l.id) === "passed");

  return (
    <div className="world-map-screen">
      <div className="world-map-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>World Map</h2>
        {player && (
          <div className="player-summary">
            {player.name} — {player.class}, Lv {player.level} ({player.xp} XP)
          </div>
        )}
        <div>
          <button className="btn" onClick={() => setScreen("spellbook")}>Spellbook</button>
          <button className="btn" onClick={openCodex}>Codex</button>
          <button className="btn" onClick={() => setScreen("inventory")}>Inventory</button>
          <button className="btn" onClick={() => setScreen("settings")}>Settings</button>
          <button className="btn" onClick={() => setScreen("title")}>Title</button>
        </div>
      </div>

      {zoneGraph.length === 0 && <p>The world is still forming... (no zones loaded)</p>}

      <div className="zone-list" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "1rem", overflowY: "auto" }}>
        {/* the sandpit stays open forever for zero-stakes practice (PHASE1.5 §2) */}
        <div className="zone-node available" style={{ border: "1px dashed #4cd137", borderRadius: 8, background: "#1a2a1d" }}>
          <button
            className="zone-header"
            style={{ width: "100%", textAlign: "left", padding: "0.75rem 1rem", background: "none", border: "none", color: "#eee", cursor: "pointer" }}
            onClick={() => setScreen("sandpit")}
          >
            <strong>⛱ the sandpit</strong>
            <span style={{ marginLeft: "1rem", fontSize: "0.85rem", color: "#999" }}>
              practice grounds — always open, nothing here counts
            </span>
          </button>
        </div>

        {zoneGraph.map((zone) => {
          const status = zoneStatus(zone.id);
          const isOpen = openZone === zone.id;
          const bossReady = zone.boss && allLessonsPassed(zone);
          const bossDown = !!save?.zones[zone.id]?.boss_defeated;

          return (
            <div key={zone.id} className={`zone-node ${status}`} style={{ border: "1px solid #333", borderRadius: 8, background: status === "locked" ? "#14142a" : "#1d1d3a" }}>
              <button
                className="zone-header"
                style={{ width: "100%", textAlign: "left", padding: "0.75rem 1rem", background: "none", border: "none", color: status === "locked" ? "#666" : "#eee", cursor: status === "locked" ? "not-allowed" : "pointer" }}
                disabled={status === "locked"}
                onClick={() => setOpenZone(isOpen ? null : zone.id)}
              >
                <strong>
                  {status === "locked" ? "🔒 " : status === "completed" ? "✅ " : "✨ "}
                  Zone {zone.number}: {zone.title}
                </strong>
                <span style={{ marginLeft: "1rem", fontSize: "0.85rem", color: "#999" }}>{zone.concept}</span>
              </button>

              {isOpen && status !== "locked" && (
                <div className="zone-lessons" style={{ padding: "0 1rem 0.75rem 2rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  {zone.lessons.length === 0 && <em style={{ color: "#777" }}>No lessons authored yet.</em>}
                  {zone.lessons.map((lesson) => {
                    const ls = lessonStatus(zone.id, lesson.id);
                    return (
                      <button
                        key={lesson.id}
                        className="btn lesson-entry"
                        style={{ textAlign: "left" }}
                        onClick={() => selectLesson(zone.id, lesson.id)}
                      >
                        {ls === "passed" ? "✔ " : "· "}{lesson.title}
                      </button>
                    );
                  })}
                  {zone.boss && (
                    <button
                      className="btn boss-entry"
                      style={{ textAlign: "left", borderColor: "#e94560" }}
                      disabled={!bossReady}
                      onClick={() => startEncounter(zone.id, zone.boss as string)}
                    >
                      {bossDown ? "✔ " : "⚔ "}Boss: {zone.boss.replace(/^encounter-/, "").replace(/-/g, " ")}
                      {!bossReady && !bossDown && " (finish the zone's lessons first)"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
