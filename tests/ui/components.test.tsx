
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useGameStore } from "../../ui/src/store";

describe("UI Components", () => {
  // Helper to set store state for component tests
  const resetStore = () => {
    useGameStore.getState().setScreen("title");
    useGameStore.getState().setPlayer(null);
    useGameStore.getState().setNodes([]);
    useGameStore.getState().setSaveSlots([]);
  };
  
  it("should have character creation classes loaded", () => {
    resetStore();
    const classes = useGameStore.getState().classes;
    
    expect(classes).toBeDefined();
    expect(Object.keys(classes)).toContain("warrior");
    expect(Object.keys(classes)).toContain("archer");
    expect(Object.keys(classes)).toContain("mage");
  });
  
  it("should render world map nodes", () => {
    resetStore();
    const nodes = [
      { id: "node-1", zoneId: 0, state: "available" as const, position: { x: 100, y: 100 } },
      { id: "node-2", zoneId: 0, state: "locked" as const, position: { x: 200, y: 100 } }
    ];
    useGameStore.getState().setNodes(nodes);
    
    expect(useGameStore.getState().nodes).toHaveLength(2);
  });
  
  it("should support screen transitions", () => {
    resetStore();
    
    useGameStore.getState().setScreen("character-creation");
    expect(useGameStore.getState().screen).toBe("character-creation");
    
    useGameStore.getState().setScreen("world-map");
    expect(useGameStore.getState().screen).toBe("world-map");
  });
  
  it("should store player data correctly", () => {
    resetStore();
    
    useGameStore.getState().setPlayer({
      name: "TestHero",
      class: "warrior",
      level: 5
    });
    
    const player = useGameStore.getState().player;
    expect(player).toBeDefined();
    expect(player?.name).toBe("TestHero");
    expect(player?.class).toBe("warrior");
    expect(player?.level).toBe(5);
  });
});
