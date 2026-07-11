
import React from "react";
import { useGameStore } from "../store";

export const LessonEncounterScreen: React.FC = () => {
  const { player, setScreen } = useGameStore();
  
  return (
    <div className="lesson-screen">
      <div className="game-panel">
        <h3>Game Panel</h3>
        <div className="scene-canvas">Scene renders here</div>
      </div>
      <div className="forge-panel">
        <div className="objective-bar">
          <strong>{player ? `Objective for ${player.class}` : "Lesson Objective"}</strong>
        </div>
        <textarea
          className="code-editor"
          value="// Write your C++ code here..."
          readOnly={true}
          rows={15}
        />
        <div className="action-bar">
          <button className="btn">CAST</button>
          <button className="btn" onClick={() => setScreen("world-map")}>Back</button>
        </div>
      </div>
    </div>
  );
};
