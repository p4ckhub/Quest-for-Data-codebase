// Game App - Main Renderer Script
const { readFile, writeFile, exists, directoryExists } = window.gameapi || {};

// State management
const AppState = {
  screen: 'title',
  player: null,
  currentZone: null,
  currentLesson: null,
  lessonAttempts: {},
  
  saveSlotData: [],
  
  loadSaveSlots: async () => {
    const slots = [];
    for (let i = 1; i <= 3; i++) {
      const path = `/appdata/CodeQuest/saves/slot${i}.json`;
      if await exists(path) {
        try {
          slots.push(JSON.parse(await readFile(path)));
        } catch { }
      }
    }
    AppState.saveSlotData = slots;
  },
  
  saveGame: async () => {
    const path = `/appdata/CodeQuest/saves/slot1.json`;
    await writeFile(path, JSON.stringify({
      player: AppState.player,
      zones: {},
      spellbook: [],
      inventory: []
    }));
  }
};

// UI Navigation
const GameApp = {
  showScreen: (screenName) => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const screen = document.getElementById(`${screenName}-screen`);
    if (screen) {
      screen.classList.add('active');
      AppState.screen = screenName;
    }
  },
  
  newGame: () => {
    GameApp.showScreen('char-creation');
  },
  
  loadSaveSlot: async (slotIndex) => {
    const path = `/appdata/CodeQuest/saves/slot${slotIndex}.json`;
    if await exists(path) {
      try {
        const data = JSON.parse(await readFile(path));
        AppState.player = data.player;
        AppState.saveGame();
        GameApp.showScreen('world-map');
      } catch (e) { console.error(e); }
    }
  },
  
  settings: () => {
    GameApp.showScreen('settings');
  },
  
  selectCharClass: async (className) => {
    const name = document.getElementById('player-name').value;
    if (!name) { alert('Please enter your name'); return; }
    
    AppState.player = { name, class: className };
    await AppState.saveGame();
    GameApp.showScreen('world-map');
  },
  
  loadZone: async (zoneId) => {
    // Load lesson content from disk
    const path = `/appdata/CodeQuest/content/zones/${zoneId}.json`;
    if await exists(path) {
      try {
        AppState.currentLesson = JSON.parse(await readFile(path));
        document.getElementById('lesson-objective').textContent = AppState.currentLesson.objective;
        
        // Initialize Monaco editor with starter code
        window.monaco?.editor?.create(document.getElementById('editor-container'), {
          value: AppState.currentLesson.starter_code,
          language: 'cpp',
          theme: 'vs-dark'
        });
        
        GameApp.showScreen('lesson');
      } catch (e) { console.error(e); }
    }
  },
  
  castCode: async () => {
    // Get code from editor
    const editor = window.monaco?.editor?.getModels()?.[0];
    if (!editor) return;
    
    const code = editor.getValue();
    
    // Compile and run in sandbox (call runner service)
    const result = await fetch('/api/run-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, lessonId: AppState.currentLesson?.id })
    }).then(r => r.json());
    
    // Display result
    const consoleDiv = document.getElementById('console-output');
    
    if (result.compile_error) {
      consoleDiv.innerHTML = `<pre style="color: #e94560;">${result.compile_error}</pre>`;
    } else if (!result.passed) {
      consoleDiv.innerHTML = `<pre style="color: #fa8231;">Validation failed: ${result.message}</pre>`;
    } else {
      consoleDiv.innerHTML = `<pre style="color: #4cd137;">Success! XP: +${AppState.currentLesson?.rewards?.xp || 0}</pre>`;
      // Update attempts counter
      const lessonId = AppState.currentLesson?.id || 'unknown';
      AppState.lessonAttempts[lessonId] = (AppState.lessonAttempts[lessonId] || 0) + 1;
      document.getElementById('attempts').textContent = `Attempt: ${AppState.lessonAttempts[lessonId]}/3`;
      
      // Update spellbook if lesson grants one
      if (AppState.currentLesson?.grants_spell && AppState.player) {
        AppState.player.spellbook.push(AppState.currentLesson.grants_spell);
      }
    }
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  await AppState.loadSaveSlots();
  
  // Render save slots
  const slotsDiv = document.getElementById('save-slots');
  if (AppState.saveSlotData.length > 0) {
    for (const [i, slot] of AppState.saveSlotData.entries()) {
      const btn = document.createElement('div');
      btn.className = 'save-slot';
      btn.textContent = `Save Slot ${i + 1}: ${slot?.player?.name || 'Empty'}`;
      btn.onclick = () => GameApp.loadSaveSlot(i + 1);
      slotsDiv.appendChild(btn);
    }
  } else {
    slotsDiv.innerHTML = '<div class="save-slot" style="opacity: 0.5;">No saves found</div>';
  }
  
  // Render class selection
  const classes = [
    { id: 'warrior', name: 'Warrior', desc: 'Front-line Artificer who binds incantations into steel' },
    { id: 'archer', name: 'Archer', desc: 'Ranger whose arrows carry compiled sigils' },
    { id: 'mage', name: 'Mage', desc: 'Scholar who casts raw incantations as bolts of force' }
  ];
  
  const classDiv = document.getElementById('class-selection');
  for (const cls of classes) {
    const card = document.createElement('div');
    card.className = 'class-card';
    card.innerHTML = `
      <h3>${cls.name}</h3>
      <p style="color: #aaa;">${cls.desc}</p>
    `;
    card.onclick = () => GameApp.selectCharClass(cls.id);
    classDiv.appendChild(card);
  }
  
  // Load Monaco editor from CDN (in production, bundle with webpack)
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
  script.onload = () => {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
    require(['vs/editor/editor.main'], (monaco) => {
      window.monaco = monaco;
    });
  };
  document.head.appendChild(script);
});

// Expose to DOM
window.gameApp = GameApp;