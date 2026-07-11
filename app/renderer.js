// Game App - Main Renderer Script

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
      try {
        const result = await window.gameapi?.saves?.load(i);
        if (result?.success && result.data) {
          slots.push(result.data);
        }
      } catch { }
    }
    AppState.saveSlotData = slots;
  },
  
  saveGame: async (slot = 1) => {
    const data = {
      save_version: 1,
      created_utc: new Date().toISOString(),
      updated_utc: new Date().toISOString(),
      player: AppState.player,
      zones: {},
      spellbook: [],
      inventory: []
    };
    await window.gameapi?.saves?.write(slot, data);
  }
};

// UI Navigation
const GameApp = {
  showScreen: (screenName) => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const screen = document.getElementById(screenName + '-screen');
    if (screen) {
      screen.classList.add('active');
      AppState.screen = screenName;
    }
  },
  
  newGame: () => {
    GameApp.showScreen('char-creation');
  },
  
  loadSaveSlot: async (slotIndex) => {
    try {
      const result = await window.gameapi?.saves?.load(slotIndex);
      if (result?.success && result.data) {
        AppState.player = result.data.player;
        await AppState.saveGame();
        GameApp.showScreen('world-map');
      } else if (result?.error) {
        console.error('Failed to load save:', result.error);
      }
    } catch (e) { 
      console.error(e); 
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
    // Load lesson content
    const result = await window.gameapi?.lessons?.load(zoneId);
    if (result?.success && result.lesson) {
      AppState.currentLesson = result.lesson;
      document.getElementById('lesson-objective').textContent = AppState.currentLesson.objective;
      
      GameApp.showScreen('lesson');
    } else if (result?.error) {
      console.error('Failed to load zone:', result.error);
    }
  },
  
  castCode: async () => {
    // Get code from Monaco editor
    const editor = window.monaco ? window.monaco.editor.getModels()[0] : null;
    if (!editor) return;
    
    const code = editor.getValue();
    const className = AppState.player?.class || 'Warrior';
    
    // Call lesson:cast IPC handler
    const result = await window.gameapi?.lessons?.cast({
      lessonId: AppState.currentLesson?.id || '',
      playerCode: code,
      className: className
    });
    
    // Display result
    const consoleDiv = document.getElementById('console-output');
    
    if (result?.compileError) {
      consoleDiv.innerHTML = '<pre style="color: #e94560;">' + result.compileError + '</pre>';
    } else if (!result?.success) {
      consoleDiv.innerHTML = '<pre style="color: #fa8231;">Failed: ' + (result?.error || 'Unknown error') + '</pre>';
    } else {
      consoleDiv.innerHTML = '<pre style="color: #4cd137;">' + result.output + '</pre>';
      // Update attempts counter
      const lessonId = AppState.currentLesson?.id || 'unknown';
      AppState.lessonAttempts[lessonId] = (AppState.lessonAttempts[lessonId] || 0) + 1;
      document.getElementById('attempts').textContent = 'Attempt: ' + AppState.lessonAttempts[lessonId] + '/3';
    }
  }
};

// Signal to main process that renderer is ready
function sendRendererReady() {
  // Try the exposed signal helper
  if (window.readySignal && typeof window.readySignal.send === 'function') {
    window.readySignal.send('renderer-ready');
    console.log('Sent renderer-ready via readySignal');
  } else {
    console.warn('readySignal not available');
  }
}

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', async () => {
  await AppState.loadSaveSlots();
  
  // Send ready signal after a short delay to ensure window is fully initialized
  setTimeout(() => {
    sendRendererReady();
  }, 100);
  
  // Render save slots
  const slotsDiv = document.getElementById('save-slots');
  if (AppState.saveSlotData.length > 0) {
    for (const [i, slot] of AppState.saveSlotData.entries()) {
      const btn = document.createElement('div');
      btn.className = 'save-slot';
      btn.textContent = 'Save Slot ' + (i + 1) + ': ' + (slot?.player?.name || 'Empty');
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
    card.innerHTML = '<h3>' + cls.name + '</h3><p style="color: #aaa;">' + cls.desc + '</p>';
    card.onclick = () => GameApp.selectCharClass(cls.id);
    classDiv.appendChild(card);
  }
  
  // Load Monaco editor from CDN (in production, bundle with webpack)
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
  script.onload = () => {
    if (window.require) {
      window.require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
      window.require(['vs/editor/editor.main'], function(monaco) {
        window.monaco = monaco;
      });
    }
  };
  document.head.appendChild(script);
});

// Expose to DOM
window.gameApp = GameApp;
