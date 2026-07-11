
import React from "react";
import { useGameStore } from "../store";

export const SettingsScreen: React.FC = () => {
  const { 
    fontSize, 
    animationSpeed, 
    reducedMotion, 
    colorblindPalette,
    rawErrorDefault,
    updateFontSize,
    updateAnimationSpeed,
    toggleReducedMotion,
    toggleColorblindPalette,
    toggleRawErrorDefault,
    setScreen
  } = useGameStore();
  
  return (
    <div className="settings-screen">
      <h2>Settings</h2>
      
      <div className="setting-group">
        <label htmlFor="font-size">Font Size</label>
        <input
          id="font-size"
          type="range"
          min="12"
          max="24"
          value={fontSize}
          onChange={(e) => updateFontSize(parseInt(e.target.value, 10))}
        />
        <span>{fontSize}px</span>
      </div>
      
      <div className="setting-group">
        <label htmlFor="animation-speed">Animation Speed</label>
        <input
          id="animation-speed"
          type="range"
          min="0.5"
          max="2"
          step="0.5"
          value={animationSpeed}
          onChange={(e) => updateAnimationSpeed(parseFloat(e.target.value))}
        />
        <span>{animationSpeed}x</span>
      </div>
      
      <div className="setting-toggle">
        <label>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={toggleReducedMotion}
          />
          Reduced Motion
        </label>
      </div>
      
      <div className="setting-toggle">
        <label>
          <input
            type="checkbox"
            checked={colorblindPalette}
            onChange={toggleColorblindPalette}
          />
          Colorblind-Safe Palette
        </label>
      </div>
      
      <div className="setting-toggle">
        <label>
          <input
            type="checkbox"
            checked={rawErrorDefault}
            onChange={toggleRawErrorDefault}
          />
          Raw Error Default
        </label>
      </div>
      
      <button className="btn" onClick={() => setScreen("title")}>Back</button>
    </div>
  );
};
