
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGameStore, type GameState } from "../../ui/src/store";

describe("Game Store", () => {
  let initialState: GameState;
  
  beforeEach(() => {
    initialState = {
      screen: "title",
      player: null,
      nodes: [],
      saveSlots: [],
      fontSize: 16,
      animationSpeed: 1,
      reducedMotion: false,
      colorblindPalette: false,
      rawErrorDefault: false,
      classes: {}
    };
    
    // Reset store before each test
    useGameStore.getState().setScreen("title");
    useGameStore.getState().setPlayer(null);
    useGameStore.getState().setNodes([]);
  });
  
  it("should initialize with default state", () => {
    const state = useGameStore.getState();
    expect(state.screen).toBe("title");
    expect(state.player).toBeNull();
    expect(state.fontSize).toBe(16);
    expect(state.animationSpeed).toBe(1);
    expect(state.reducedMotion).toBe(false);
  });
  
  it("should change screen", () => {
    useGameStore.getState().setScreen("character-creation");
    expect(useGameStore.getState().screen).toBe("character-creation");
  });
  
  it("should set player", () => {
    useGameStore.getState().setPlayer({ name: "Test", class: "warrior", level: 1 });
    const player = useGameStore.getState().player;
    expect(player?.name).toBe("Test");
    expect(player?.class).toBe("warrior");
    expect(player?.level).toBe(1);
  });
  
  it("should toggle reduced motion", () => {
    expect(useGameStore.getState().reducedMotion).toBe(false);
    useGameStore.getState().toggleReducedMotion();
    expect(useGameStore.getState().reducedMotion).toBe(true);
    useGameStore.getState().toggleReducedMotion();
    expect(useGameStore.getState().reducedMotion).toBe(false);
  });
  
  it("should toggle colorblind palette", () => {
    expect(useGameStore.getState().colorblindPalette).toBe(false);
    useGameStore.getState().toggleColorblindPalette();
    expect(useGameStore.getState().colorblindPalette).toBe(true);
  });
  
  it("should update font size", () => {
    useGameStore.getState().updateFontSize(20);
    expect(useGameStore.getState().fontSize).toBe(20);
  });
});
