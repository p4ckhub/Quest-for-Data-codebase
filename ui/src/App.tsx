import React, { useState, useEffect } from 'react';
import './styles.css';

interface Player {
  name: string;
  class: string;
  level?: number;
}

interface Lesson {
  id: string;
  objective: string;
  starter_code: string;
  rewards?: { xp: number };
}

interface SaveSlot {
  player?: Player;
}

function App() {
  const [screen, setScreen] = useState<string>('title');
  const [player, setPlayer] = useState<Player | null>(null);
  const [saveSlots, setSaveSlots] = useState<SaveSlot[]>([]);

  useEffect(() => {
    setSaveSlots([]);
  }, []);

  const showScreen = (name: string) => setScreen(name);
  
  const newGame = () => showScreen('char-creation');
  
  const loadSaveSlot = async (index: number) => {
    showScreen('world-map');
  };
  
  const selectCharClass = (className: string) => {
    if (!player?.name) return;
    setPlayer({ name: player.name, class: className, level: 1 });
    showScreen('world-map');
  };
  
  const loadZone = async (zoneId: string) => {
    setScreen('lesson');
  };

  return (
    <div className="app">
      {screen === 'title' && (
        <div className="title-screen">
          <h1 className="title-logo">Quest for Data</h1>
          <button className="btn" onClick={newGame}>New Game</button>
          {saveSlots.map((slot, i) => (
            <div key={i} className="save-slot" onClick={() => loadSaveSlot(i + 1)}>
              Slot {i + 1}: {slot.player?.name || 'Empty'}
            </div>
          ))}
          <button className="btn" onClick={() => showScreen('settings')}>Settings</button>
        </div>
      )}

      {screen === 'char-creation' && (
        <div className="char-screen">
          <h2>Create Your Character</h2>
          <input
            type="text"
            placeholder="Enter your name"
            value={player?.name || ''}
            onChange={(e) => {
              const name = e.target.value;
              if (name.length > 0 && player?.class) {
                setPlayer({ name, class: player.class, level: 1 });
              } else {
                setPlayer(name ? { name, class: 'warrior', level: 1 } : null);
              }
            }}
          />
          <div className="class-selection">
            {['warrior', 'archer', 'mage'].map((cls) => (
              <div key={cls} className="class-card" onClick={() => selectCharClass(cls)}>
                <h3>{cls.charAt(0).toUpperCase() + cls.slice(1)}</h3>
                <p>{cls === 'warrior' ? 'Front-line Artificer' : 
                     cls === 'archer' ? 'Ranger with sigil arrows' : 
                     'Scholar casting raw incantations'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {screen === 'world-map' && (
        <div className="map-screen">
          <h2>World Map</h2>
          <div className="zone-nodes">
            <button onClick={() => loadZone('vault_of_variables')}>Vault of Variables</button>
            <button onClick={() => loadZone('function_forge')}>Function Forge</button>
          </div>
          <button className="btn" onClick={() => showScreen('title')}>Back</button>
        </div>
      )}

      {screen === 'lesson' && (
        <div className="lesson-screen">
          <div className="game-panel">
            <h3>Game Panel</h3>
            <div className="scene-canvas">Scene renders here</div>
          </div>
          <div className="forge-panel">
            <div className="objective-bar">
              <strong>{player ? `Objective for ${player.class}` : 'Lesson Objective'}</strong>
            </div>
            <textarea
              className="code-editor"
              value="// Write your C++ code here..."
              readOnly={true}
              rows={15}
            />
            <div className="action-bar">
              <button className="btn">CAST</button>
              <button className="btn" onClick={() => showScreen('world-map')}>Back</button>
            </div>
          </div>
        </div>
      )}

      {screen === 'spellbook' && (
        <div className="spell-screen">
          <h2>Spellbook</h2>
          <button className="btn" onClick={() => showScreen('title')}>Back</button>
        </div>
      )}

      {screen === 'settings' && (
        <div className="settings-screen">
          <h2>Settings</h2>
          <label><input type="checkbox" /> Reduced Motion</label>
          <label><input type="checkbox" /> Colorblind-Safe Palette</label>
          <button className="btn" onClick={() => showScreen('title')}>Back</button>
        </div>
      )}
    </div>
  );
}

export default App;
