
import { useGameStore } from "./store";

export interface GameEvent {
  type: string;
  payload?: Record<string, unknown>;
}

interface EventHandlers {
  [key: string]: (payload?: Record<string, unknown>) => void;
}

const handlers: EventHandlers = {
  "playSound": (payload) => {
    // No-op seam - sound system will be implemented later
    console.log("playSound event received", payload);
  },
  
  "showScreen": (payload) => {
    const screen = payload?.screen as string;
    if (screen && useGameStore.getState().setScreen) {
      useGameStore.getState().setScreen(screen as any);
    }
  },
  
  "updatePlayer": (payload) => {
    const player = payload?.player as any;
    if (player) {
      useGameStore.getState().setPlayer({
        name: player.name || "",
        class: player.class || "",
        level: player.level || 1,
        xp: player.xp || 0,
        stats: player.stats || { hp: 100, mp: 20, str: 10, agi: 10, int: 10 }
      });
    }
  }
};

export function dispatchEvent(event: GameEvent): void {
  const handler = handlers[event.type];
  
  if (handler) {
    handler(event.payload);
  } else {
    // Unknown event types are ignored (§9.4/§11.7 future-proofing)
    console.debug(`Unknown event type: ${event.type}`);
  }
}

export function playSound(id: string): void {
  // No-op seam - will be implemented with Web Audio API
  console.log(`playSound(${id}) - no-op`);
}
