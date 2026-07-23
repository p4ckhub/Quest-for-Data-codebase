
import { create } from "zustand";
import classesData from "../../content/classes.json";

export type Screen =
  | "title"
  | "save-select"
  | "character-creation"
  | "sandpit"
  | "world-map"
  | "lesson-encounter"
  | "combat"
  | "spellbook"
  | "inventory"
  | "codex"
  | "settings";

export interface PlayerData {
  name: string;
  class: string;
  level: number;
  xp: number;
  stats: { hp: number; mp: number; str: number; agi: number; int: number };
}

// Kept for legacy imports; the world map now renders zones from the zone graph
export interface WorldNode {
  id: string;
  zoneId: number;
  state: "locked" | "available" | "completed";
  position: { x: number; y: number };
  name: string;
  lessonId?: string;
}

export interface ZoneInfo {
  id: string;
  number: number;
  title: string;
  concept: string;
  boss?: string;
  lessons: Array<{ id: string; title: string; concept: string }>;
}

// the sandpit (PHASE1.5 §2): standalone practice zone. Mandatory lessons gate
// the world map and grant real saved progress; everything else is zero-stakes.
export interface SandpitInfo {
  id: "sandpit";
  title: string;
  lessons: Array<{ id: string; title: string; concept: string; mandatory: boolean }>;
}

export interface SpellEntry {
  lesson_id: string;
  name: string;
  signature: string;
  source: string;
  equipped: boolean;
}

export interface LessonProgress {
  status: "passed" | "available";
  attempts: number;
  player_region: string;
}

export interface ZoneProgress {
  status: "locked" | "available" | "passed" | "completed";
  boss_defeated?: boolean;
  lessons: Record<string, LessonProgress>;
}

export interface SaveData {
  save_version: 1;
  created_utc: string;
  updated_utc: string;
  player: PlayerData;
  zones: Record<string, ZoneProgress>;
  spellbook: SpellEntry[];
  inventory: Array<{ item_id: string; count: number }>;
  settings_snapshot: { reduced_motion: boolean };
  // The sandpit's opening welcome is required reading, shown once. Absent on
  // older saves — treated as unseen, so returning players read it once too.
  intro_seen?: boolean;
}

interface ClassInfo {
  display_name: string;
  description: string;
  attack_style: string;
  weapon: string;
  base_stats: { hp: number; mp: number; str: number; agi: number; int: number };
  starter_spell: { name: string; signature: string };
  damage_formula: { dice_min: number; dice_max: number; scaling_stat: string; scaling_div: number; mp_cost: number };
  palette: string;
}

export interface GameState {
  screen: Screen;
  player: PlayerData | null;
  slot: number | null;
  save: SaveData | null;
  zoneGraph: ZoneInfo[];
  sandpit: SandpitInfo | null;
  currentZoneId: string | null;
  currentLessonId: string | null;
  currentEncounterId: string | null;
  // Screen to return to when the Codex is closed (it opens over a hub).
  codexReturn: Screen;

  // legacy fields still referenced by older components/tests
  nodes: WorldNode[];
  saveSlots: Array<{ player?: PlayerData }>;

  // Settings
  fontSize: number;
  animationSpeed: number;
  reducedMotion: boolean;
  colorblindPalette: boolean;
  rawErrorDefault: boolean;

  // Content data (read-only, loaded from JSON)
  classes: Record<string, ClassInfo>;

  // Actions
  setScreen: (screen: Screen) => void;
  setPlayer: (player: PlayerData | null) => void;
  setNodes: (nodes: WorldNode[]) => void;
  setSaveSlots: (slots: Array<{ player?: PlayerData }>) => void;
  updateFontSize: (size: number) => void;
  updateAnimationSpeed: (speed: number) => void;
  toggleReducedMotion: () => void;
  toggleColorblindPalette: () => void;
  toggleRawErrorDefault: () => void;

  loadZoneGraph: () => Promise<void>;
  loadSandpit: () => Promise<void>;
  sandpitComplete: () => boolean;
  newGame: (slot: number, name: string, playerClass: string) => Promise<boolean>;
  loadGame: (slot: number) => Promise<boolean>;
  persistSave: () => Promise<void>;
  selectLesson: (zoneId: string, lessonId: string) => void;
  startEncounter: (zoneId: string, encounterId: string) => void;
  openCodex: () => void;
  markIntroSeen: () => Promise<void>;
  recordAttempt: (lessonId: string, playerRegion: string) => void;
  completeLesson: (lesson: {
    id: string;
    rewards?: { xp?: number; items?: Array<{ item_id: string; count: number }> };
    grants_spell?: { name: string; signature: string };
  }, playerRegion: string) => Promise<void>;
  completeBoss: (zoneId: string, xp: number) => Promise<void>;

  zoneStatus: (zoneId: string) => "locked" | "available" | "completed";
  equippedSpell: () => SpellEntry | null;
}

const CLASSES = (classesData as any).classes as Record<string, ClassInfo>;

export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.sqrt(xp / 100));
}

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function freshSave(name: string, playerClass: string): SaveData {
  const cls = CLASSES[playerClass];
  return {
    save_version: 1,
    created_utc: nowUtc(),
    updated_utc: nowUtc(),
    player: {
      name,
      class: playerClass,
      // Level 0 until the sandpit's mandatory lessons are done — the level-up
      // TO 1 is the sandpit's ceremony (PHASE1.5 §2)
      level: 0,
      xp: 0,
      stats: { ...cls.base_stats },
    },
    zones: {},
    spellbook: [],
    inventory: [],
    settings_snapshot: { reduced_motion: false },
  };
}

const gameapi = () => (typeof window !== "undefined" ? (window as any).gameapi : undefined);

export const useGameStore = create<GameState>((set, get) => ({
  screen: "title",
  player: null,
  slot: null,
  save: null,
  zoneGraph: [],
  sandpit: null,
  currentZoneId: null,
  currentLessonId: null,
  currentEncounterId: null,
  codexReturn: "world-map",
  nodes: [],
  saveSlots: [],
  fontSize: 16,
  animationSpeed: 1,
  reducedMotion: false,
  colorblindPalette: false,
  rawErrorDefault: false,
  classes: CLASSES,

  setScreen: (screen) => set({ screen }),
  setPlayer: (player) => set({ player }),
  setNodes: (nodes) => set({ nodes }),
  setSaveSlots: (saveSlots) => set({ saveSlots }),
  updateFontSize: (fontSize) => set({ fontSize }),
  updateAnimationSpeed: (animationSpeed) => set({ animationSpeed }),
  toggleReducedMotion: () => set((state) => ({ reducedMotion: !state.reducedMotion })),
  toggleColorblindPalette: () => set((state) => ({ colorblindPalette: !state.colorblindPalette })),
  toggleRawErrorDefault: () => set((state) => ({ rawErrorDefault: !state.rawErrorDefault })),

  loadZoneGraph: async () => {
    const api = gameapi();
    if (!api) return;
    const result = await api.content.get("zoneGraph");
    if (result?.success && result.graph?.act1?.zones) {
      set({ zoneGraph: result.graph.act1.zones });
    }
  },

  loadSandpit: async () => {
    const api = gameapi();
    if (!api) return;
    const result = await api.content.get("sandpit");
    if (result?.success && result.sandpit) {
      set({ sandpit: result.sandpit });
    }
  },

  // True once every mandatory sandpit lesson is passed in the save. With no
  // sandpit content loaded there is nothing to gate on.
  sandpitComplete: () => {
    const { save, sandpit } = get();
    const mandatory = sandpit?.lessons.filter((l) => l.mandatory) ?? [];
    if (mandatory.length === 0) return true;
    return mandatory.every((l) => save?.zones["sandpit"]?.lessons[l.id]?.status === "passed");
  },

  newGame: async (slot, name, playerClass) => {
    const save = freshSave(name, playerClass);
    const api = gameapi();
    if (api) {
      const result = await api.saves.write(slot, save);
      if (!result?.success) {
        console.error("Failed to write new save:", result?.error);
        return false;
      }
    }
    // A fresh champion wakes in the sandpit; the world map stays out of
    // reach until the mandatory lessons are done (PHASE1.5 §2)
    set({ slot, save, player: save.player, screen: "sandpit" });
    return true;
  },

  loadGame: async (slot) => {
    const api = gameapi();
    if (!api) return false;
    const result = await api.saves.load(slot);
    if (!result?.success || !result.data) {
      console.error("Failed to load save:", result?.error);
      return false;
    }
    const save = result.data as SaveData;
    set({ slot, save, player: save.player });
    set({ screen: get().sandpitComplete() ? "world-map" : "sandpit" });
    return true;
  },

  persistSave: async () => {
    const { slot, save } = get();
    if (slot === null || !save) return;
    save.updated_utc = nowUtc();
    const api = gameapi();
    if (api) {
      const result = await api.saves.write(slot, save);
      if (!result?.success) console.error("Failed to persist save:", result?.error);
    }
  },

  selectLesson: (zoneId, lessonId) =>
    set({ currentZoneId: zoneId, currentLessonId: lessonId, screen: "lesson-encounter" }),

  startEncounter: (zoneId, encounterId) =>
    set({ currentZoneId: zoneId, currentEncounterId: encounterId, screen: "combat" }),

  // The Codex opens over whichever hub summoned it and returns there on close.
  openCodex: () => set({ codexReturn: get().screen, screen: "codex" }),

  // Mark the sandpit's welcome as read and persist it, so it shows only once.
  markIntroSeen: async () => {
    const { save } = get();
    if (!save) return;
    save.intro_seen = true;
    set({ save: { ...save } });
    await get().persistSave();
  },

  recordAttempt: (lessonId, playerRegion) => {
    const { save, currentZoneId, sandpit } = get();
    if (!save || !currentZoneId) return;
    // Zero-stakes practice leaves no trace in the save (PHASE1.5 §2)
    if (currentZoneId === "sandpit") {
      const entry = sandpit?.lessons.find((l) => l.id === lessonId);
      if (!entry?.mandatory) return;
    }
    const zone = (save.zones[currentZoneId] ??= { status: "available", lessons: {} });
    const lesson = (zone.lessons[lessonId] ??= { status: "available", attempts: 0, player_region: "" });
    lesson.attempts += 1;
    lesson.player_region = playerRegion;
    set({ save: { ...save } });
  },

  completeLesson: async (lesson, playerRegion) => {
    // With whole-program starters (PHASE2 P2-0.5) the editor holds a complete
    // file. The spellbook wants only the forged functions: strip #include
    // lines and the player's main() so namespace-wrapping in spellbook.h
    // stays legal C++.
    const toSpellSource = (region: string): string => {
      const noIncludes = region
        .split("\n")
        .filter((l) => !/^\s*#include\b/.test(l))
        .join("\n");
      const mainMatch = /(^|\n)[ \t]*int\s+main\s*\([^)]*\)\s*\{/.exec(noIncludes);
      if (!mainMatch) return noIncludes.trim();
      const start = mainMatch.index + mainMatch[1].length;
      let i = noIncludes.indexOf("{", start);
      let depth = 0;
      for (; i < noIncludes.length; i++) {
        if (noIncludes[i] === "{") depth++;
        else if (noIncludes[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      return (noIncludes.slice(0, start) + noIncludes.slice(i)).trim();
    };

    const { save, currentZoneId, player, sandpit } = get();
    if (!save || !currentZoneId || !player) return;

    // the sandpit: mandatory lessons are real saved progress and, once all
    // are passed, level the player up TO 1 (the ceremony of the stone
    // delivers the item via lesson rewards). Optional sandpit lessons are
    // pure practice — they change nothing and persist nothing. (PHASE1.5 §2)
    if (currentZoneId === "sandpit") {
      const entry = sandpit?.lessons.find((l) => l.id === lesson.id);
      if (!entry?.mandatory) return;

      const pit = (save.zones["sandpit"] ??= { status: "available", lessons: {} });
      const progress = (pit.lessons[lesson.id] ??= { status: "available", attempts: 0, player_region: "" });
      progress.status = "passed";
      progress.player_region = playerRegion;

      for (const item of lesson.rewards?.items ?? []) {
        const existing = save.inventory.find((i) => i.item_id === item.item_id);
        if (existing) existing.count += item.count;
        else save.inventory.push({ ...item });
      }

      const mandatory = sandpit?.lessons.filter((l) => l.mandatory) ?? [];
      const allPassed = mandatory.every((l) => pit.lessons[l.id]?.status === "passed");
      if (allPassed) {
        pit.status = "completed";
        if (save.player.level < 1) save.player.level = 1;
      }

      set({ save: { ...save }, player: { ...save.player } });
      await get().persistSave();
      return;
    }

    const zone = (save.zones[currentZoneId] ??= { status: "available", lessons: {} });
    const progress = (zone.lessons[lesson.id] ??= { status: "available", attempts: 0, player_region: "" });
    progress.status = "passed";
    progress.player_region = playerRegion;

    if (lesson.rewards?.xp) {
      save.player.xp += lesson.rewards.xp;
      save.player.level = levelForXp(save.player.xp);
    }
    for (const item of lesson.rewards?.items ?? []) {
      const existing = save.inventory.find((i) => i.item_id === item.item_id);
      if (existing) existing.count += item.count;
      else save.inventory.push({ ...item });
    }

    if (lesson.grants_spell) {
      // Source of truth is the save (§11.8); one entry per lesson_id
      const existing = save.spellbook.find((s) => s.lesson_id === lesson.id);
      const spellSource = toSpellSource(playerRegion);
      if (existing) {
        existing.source = spellSource;
      } else {
        save.spellbook.push({
          lesson_id: lesson.id,
          name: lesson.grants_spell.name,
          signature: lesson.grants_spell.signature,
          source: spellSource,
          equipped: save.spellbook.length === 0, // first forged spell auto-equips
        });
      }
    }

    // Zone status: passed when every listed lesson is passed; completed when
    // the boss (if any) is also down
    const zoneInfo = get().zoneGraph.find((z) => z.id === currentZoneId);
    if (zoneInfo) {
      const allPassed = zoneInfo.lessons.every((l) => zone.lessons[l.id]?.status === "passed");
      if (allPassed) {
        zone.status = zoneInfo.boss && !zone.boss_defeated ? "passed" : "completed";
      }
    }

    set({ save: { ...save }, player: { ...save.player } });
    await get().persistSave();
  },

  completeBoss: async (zoneId, xp) => {
    const { save } = get();
    if (!save) return;
    const zone = (save.zones[zoneId] ??= { status: "available", lessons: {} });
    zone.boss_defeated = true;
    zone.status = "completed";
    save.player.xp += xp;
    save.player.level = levelForXp(save.player.xp);
    set({ save: { ...save }, player: { ...save.player } });
    await get().persistSave();
  },

  zoneStatus: (zoneId) => {
    const { save, zoneGraph } = get();
    const zoneInfo = zoneGraph.find((z) => z.id === zoneId);
    if (!zoneInfo) return "locked";
    if (save?.zones[zoneId]?.status === "completed") return "completed";
    if (zoneInfo.number === 0) return "available";
    const prev = zoneGraph.find((z) => z.number === zoneInfo.number - 1);
    if (!prev) return "available";
    return save?.zones[prev.id]?.status === "completed" ? "available" : "locked";
  },

  equippedSpell: () => {
    const { save } = get();
    return save?.spellbook.find((s) => s.equipped) ?? save?.spellbook[0] ?? null;
  },
}));
