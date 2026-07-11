import { describe, it, expect, beforeEach } from "vitest";
import { useGameStore, SandpitInfo, SaveData } from "../../ui/src/store";

// the sandpit store rules (PHASE1.5 §2): mandatory lessons gate the world map
// and grant level-up-TO-1 + the smooth river stone as real saved progress;
// optional lessons are zero-stakes and leave no trace in the save.

const SANDPIT: SandpitInfo = {
  id: "sandpit",
  title: "the sandpit",
  lessons: [
    { id: "sandpit-the-first-words", title: "The First Words", concept: "cout", mandatory: true },
    { id: "sandpit-the-vessel", title: "The Vessel", concept: "main_function", mandatory: true },
    { id: "sandpit-brown-hair", title: "The Mirror Pool", concept: "variables", mandatory: false },
  ],
};

function freshTestSave(): SaveData {
  return {
    save_version: 1,
    created_utc: "2026-07-10T00:00:00Z",
    updated_utc: "2026-07-10T00:00:00Z",
    player: { name: "Test", class: "warrior", level: 0, xp: 0, stats: { hp: 30, mp: 10, str: 8, agi: 5, int: 3 } },
    zones: {},
    spellbook: [],
    inventory: [],
    settings_snapshot: { reduced_motion: false },
  };
}

describe("sandpit store rules", () => {
  beforeEach(() => {
    useGameStore.setState({
      sandpit: SANDPIT,
      save: freshTestSave(),
      player: freshTestSave().player,
      slot: null, // persistSave no-ops without a slot; these tests exercise state rules
      currentZoneId: "sandpit",
      zoneGraph: [],
    });
  });

  it("a fresh champion is level 0 and the sandpit is incomplete", () => {
    const s = useGameStore.getState();
    expect(s.save!.player.level).toBe(0);
    expect(s.sandpitComplete()).toBe(false);
  });

  it("passing one mandatory lesson records progress but does not level up", async () => {
    await useGameStore.getState().completeLesson({ id: "sandpit-the-first-words", rewards: { xp: 0 } }, "code");
    const s = useGameStore.getState();
    expect(s.save!.zones["sandpit"].lessons["sandpit-the-first-words"].status).toBe("passed");
    expect(s.save!.player.level).toBe(0);
    expect(s.sandpitComplete()).toBe(false);
  });

  it("passing both mandatory lessons levels the player up TO 1 and grants the stone", async () => {
    await useGameStore.getState().completeLesson({ id: "sandpit-the-first-words", rewards: { xp: 0 } }, "code");
    await useGameStore.getState().completeLesson(
      { id: "sandpit-the-vessel", rewards: { xp: 0, items: [{ item_id: "smooth_river_stone", count: 1 }] } },
      "code"
    );
    const s = useGameStore.getState();
    expect(s.save!.player.level).toBe(1);
    expect(s.save!.inventory).toContainEqual({ item_id: "smooth_river_stone", count: 1 });
    expect(s.save!.zones["sandpit"].status).toBe("completed");
    expect(s.sandpitComplete()).toBe(true);
  });

  it("optional sandpit lessons are zero-stakes: nothing recorded, no rewards", async () => {
    await useGameStore.getState().completeLesson(
      { id: "sandpit-brown-hair", rewards: { xp: 500, items: [{ item_id: "crown_of_kings", count: 1 }] } },
      "code"
    );
    const s = useGameStore.getState();
    expect(s.save!.zones["sandpit"]?.lessons?.["sandpit-brown-hair"]).toBeUndefined();
    expect(s.save!.player.level).toBe(0);
    expect(s.save!.player.xp).toBe(0);
    expect(s.save!.inventory).toEqual([]);
  });

  it("recordAttempt leaves no trace for optional sandpit lessons but tracks mandatory ones", () => {
    const store = useGameStore.getState();
    store.recordAttempt("sandpit-brown-hair", "code");
    expect(useGameStore.getState().save!.zones["sandpit"]).toBeUndefined();
    store.recordAttempt("sandpit-the-first-words", "code");
    expect(useGameStore.getState().save!.zones["sandpit"].lessons["sandpit-the-first-words"].attempts).toBe(1);
  });

  it("sandpitComplete gates on mandatory lessons only", async () => {
    await useGameStore.getState().completeLesson({ id: "sandpit-the-first-words" }, "code");
    await useGameStore.getState().completeLesson({ id: "sandpit-the-vessel" }, "code");
    // optional lesson never touched — still complete
    expect(useGameStore.getState().sandpitComplete()).toBe(true);
  });

  it("with no sandpit content loaded, nothing is gated", () => {
    useGameStore.setState({ sandpit: null });
    expect(useGameStore.getState().sandpitComplete()).toBe(true);
  });

  it("wild-zone lessons still level through XP as before", async () => {
    useGameStore.setState({
      currentZoneId: "character_creation",
      zoneGraph: [{ id: "character_creation", number: 0, title: "t", concept: "c", lessons: [{ id: "awakening-101", title: "t", concept: "c" }] }],
    });
    await useGameStore.getState().completeLesson({ id: "awakening-101", rewards: { xp: 50 } }, "code");
    const s = useGameStore.getState();
    expect(s.save!.player.xp).toBe(50);
    expect(s.save!.player.level).toBe(1);
  });
});
