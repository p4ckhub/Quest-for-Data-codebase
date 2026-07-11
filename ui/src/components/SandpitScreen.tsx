import React from "react";
import { useGameStore } from "../store";

// the sandpit (PHASE1.5 §2): always lowercase in-game. Mandatory lessons gate
// the world map; optional lessons are zero-stakes practice, replayable forever.

export const SandpitScreen: React.FC = () => {
  const { sandpit, save, player, setScreen, selectLesson, sandpitComplete } = useGameStore();

  const lessonPassed = (lessonId: string): boolean =>
    save?.zones["sandpit"]?.lessons[lessonId]?.status === "passed";

  const complete = sandpitComplete();
  const mandatory = sandpit?.lessons.filter((l) => l.mandatory) ?? [];
  const optional = sandpit?.lessons.filter((l) => !l.mandatory) ?? [];
  // Mandatory lessons unlock in manifest order
  const firstUnpassed = mandatory.findIndex((l) => !lessonPassed(l.id));

  return (
    <div className="sandpit-screen">
      <div className="sandpit-header">
        <h2>the sandpit</h2>
        {player && (
          <div className="player-summary">
            {player.name} — {player.class}, Lv {player.level}
          </div>
        )}
      </div>

      <div className="sandpit-body">
        <p className="sandpit-intro">
          Warm sand in every direction. A figure waits here — it wears a shape like
          yours, weathered by more years than the sky has stars. Nothing cast in this
          place can break, and nothing here is ever lost by failing.
        </p>

        <div className="sandpit-section">
          <h3>The Forerunner's teachings</h3>
          {mandatory.map((lesson, i) => {
            const passed = lessonPassed(lesson.id);
            const locked = firstUnpassed !== -1 && i > firstUnpassed;
            return (
              <button
                key={lesson.id}
                className="btn lesson-entry"
                style={{ textAlign: "left", display: "block", width: "100%" }}
                disabled={locked}
                onClick={() => selectLesson("sandpit", lesson.id)}
              >
                {passed ? "✔ " : locked ? "🔒 " : "· "}{lesson.title}
              </button>
            );
          })}
        </div>

        {optional.length > 0 && (
          <div className="sandpit-section">
            <h3>Free practice</h3>
            <p className="sandpit-note">
              Cast as much as you like. Nothing here counts, and nothing is kept —
              that is the point.
            </p>
            {optional.map((lesson) => (
              <button
                key={lesson.id}
                className="btn lesson-entry"
                style={{ textAlign: "left", display: "block", width: "100%" }}
                disabled={!complete}
                onClick={() => selectLesson("sandpit", lesson.id)}
              >
                · {lesson.title}
              </button>
            ))}
          </div>
        )}

        {complete && (
          <div className="sandpit-ceremony">
            <p>
              The Forerunner sets a jagged rock into a basin of water and gestures for
              you to pull it out. It comes up smooth as glass.
            </p>
            <p className="ceremony-words">
              "The element of water wins because of patience and persistence.
              Because of this, water is capable of overcoming any foe."
            </p>
            <p>
              The smooth river stone settles into your pack. It has no power at all.
              Carry it anyway. <strong>You are Level 1.</strong>
            </p>
            <button className="btn cast-btn" onClick={() => setScreen("world-map")}>
              Depart for the realm ➜
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
