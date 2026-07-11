# How Quest for Data Works

This document explains the entire codebase: what each part does, how the parts talk to each other, and how to change things safely. It assumes you have never written code before. Technical words are explained the first time they appear, and there is a [glossary](#14-glossary) at the end.

If you only came here to add a lesson, jump straight to [How to add a new sandpit lesson](#12-how-to-add-a-new-sandpit-lesson-step-by-step).

---

## Table of Contents

1. [What this game actually is](#1-what-this-game-actually-is)
2. [The big picture: three programs working together](#2-the-big-picture-three-programs-working-together)
3. [A tour of the folders](#3-a-tour-of-the-folders)
4. [What happens when the game boots](#4-what-happens-when-the-game-boots)
5. [How the two halves talk: the bridge](#5-how-the-two-halves-talk-the-bridge)
6. [Screens and the game's memory (the store)](#6-screens-and-the-games-memory-the-store)
7. [The life of a CAST: what happens when you press the button](#7-the-life-of-a-cast-what-happens-when-you-press-the-button)
8. [Anatomy of a lesson file](#8-anatomy-of-a-lesson-file)
9. [How the game finds its content](#9-how-the-game-finds-its-content)
10. [Saving and loading](#10-saving-and-loading)
11. [Combat and boss fights](#11-combat-and-boss-fights)
12. [How to add a new sandpit lesson (step by step)](#12-how-to-add-a-new-sandpit-lesson-step-by-step)
13. [Scripts, tests, and how to check your work](#13-scripts-tests-and-how-to-check-your-work)
14. [Glossary](#14-glossary)

---

## 1. What this game actually is

Quest for Data is a fantasy RPG that teaches real C++ programming. The player walks through zones, opens lessons, and writes actual C++ code in a built-in code editor. When they press **CAST**, the game genuinely compiles their code with a real compiler, runs it inside a safety cage, checks the result against the lesson's rules, and rewards them if it passes. Nothing is simulated. If the player's code is broken, the real compiler complains, and the game translates that complaint into friendlier language.

So under the costume, this project is three things stapled together:

1. A desktop application (the windows, buttons, art, and story).
2. A miniature C++ build system (the thing that compiles and runs the player's code).
3. A folder full of content files (the lessons, zones, classes, and boss fights, written as plain text files that non-programmers can edit).

The rest of this document explains each piece and the seams between them.

---

## 2. The big picture: three programs working together

When the game is running, there are really **three separate programs** alive on your computer, and understanding which one does what explains almost everything about this codebase.

### Program 1: the "main process" (the backstage manager)

Electron is a tool that lets people build desktop apps using web technology. Every Electron app has a **main process**: a behind-the-scenes program with full access to your computer. It can read files, start other programs, and create windows. Ours lives in [app/main.ts](app/main.ts).

Think of it as the backstage manager of a theater. It never appears on stage, but it opens the theater, reads the scripts (lesson files) off the shelf, and handles anything dangerous.

### Program 2: the "renderer" (the stage)

The window you actually see is called the **renderer**. It is essentially a web page: everything visual is built with React (a popular tool for building user interfaces) and lives in [ui/src/](ui/src/). The renderer is deliberately **locked in a box**: it cannot read files or touch your computer directly. This is a standard safety design. If anything in the visible window ever went haywire, it has no power to damage anything.

When the renderer needs something from the real world ("load lesson X", "save the game"), it has to politely ask the main process through a narrow, guarded mail slot. That mail slot is described in [section 5](#5-how-the-two-halves-talk-the-bridge).

### Program 3: the player's own C++ program

This is the special one. Every time the player presses CAST, the game builds a brand new, real C++ program out of the player's code, compiles it with `g++` (a real, industry-standard C++ compiler), and runs it. That program is a genuinely separate process, and it runs inside a watchdog called `sandbox_run` that kills it if it loops forever, eats too much memory, or prints endlessly. Details in [section 7](#7-the-life-of-a-cast-what-happens-when-you-press-the-button).

### The picture in one diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Electron main process (app/main.ts)                        │
│  "the backstage manager"                                     │
│   • creates the window                                       │
│   • reads lesson/zone/save files from disk                   │
│   • compiles + runs player code via runner/                  │
│         ▲                                                    │
│         │  IPC: a guarded question-and-answer channel        │
│         ▼                                                    │
│  Renderer (ui/src/, shown in the window)                     │
│  "the stage"                                                 │
│   • title screen, world map, lesson screen, combat, etc.     │
│   • the Monaco code editor the player types into             │
│   • holds the current game state (zustand store)             │
└─────────────────────────────────────────────────────────────┘
          │ (only during a CAST)
          ▼
   Player's compiled C++ program, caged by toolchain/bin/sandbox_run
```

---

## 3. A tour of the folders

Here is the repository, top to bottom, with what each folder is for.

| Folder / file | What lives there |
|---|---|
| [app/](app/) | The Electron main process: window creation ([main.ts](app/main.ts)), the safety bridge ([preload.ts](app/preload.ts)), and save file handling ([saves.ts](app/saves.ts)). |
| [ui/](ui/) | The entire visible game. A self-contained React project with its own `package.json`. Screens are in [ui/src/components/](ui/src/components/), shared game state in [ui/src/store.ts](ui/src/store.ts). |
| [runner/](runner/) | The lesson engine. Assembles the player's code into a full C++ file, compiles it, runs it in the sandbox, and grades the result. Heart of the game: [runner/src/index.ts](runner/src/index.ts) and [runner/src/validator.ts](runner/src/validator.ts). |
| [content/](content/) | **All game content.** Lessons, zones, the sandpit, character classes, boss encounters. These are plain text files (YAML and JSON). You can add or edit lessons without touching a line of program code. |
| [gameapi/](gameapi/) | The C++ side. `gameapi.h`/`gameapi.cpp` are compiled *into* every player program and give it spell-like powers (`gameapi::report(...)` etc.). The `*_main.cpp` files are "harnesses": pre-written `main()` functions for lessons where the player only writes a function. |
| [toolchain/](toolchain/) | The compiler configuration (`toolchain.lock.json` points at the system `g++`) and the sandbox watchdog binary (`toolchain/bin/sandbox_run`). |
| [schemas/](schemas/) | Formal descriptions of what a valid lesson file, save file, and class file must look like. Used by the validation scripts. |
| [scripts/](scripts/) | Developer tools: content validators, acceptance test suites for each build phase, and the end-to-end test driver that plays the whole game by robot. |
| [tests/](tests/) | Unit tests (run with `npx vitest run`). |
| [dist/](dist/) | Machine-generated output. Running the TypeScript compiler (`npx tsc`) translates `app/`, `runner/`, and `scripts/` into plain JavaScript here, because Electron runs JavaScript, not TypeScript. Never edit anything in `dist/` by hand; it gets overwritten. |
| [DECISIONS.md](DECISIONS.md) | The running log of design and engineering decisions and why they were made. |
| [BUGS.md](BUGS.md) | The log of bugs found and fixed. |

One important idea before moving on: **TypeScript vs JavaScript**. The code here is written in TypeScript, which is JavaScript plus type annotations (little labels saying "this variable holds a number"). Computers only run the JavaScript form, so there is a build step (`npx tsc`) that strips the labels and writes the result into `dist/`. Similarly the UI has its own build step (`cd ui && npm run build`) that packs all the React code into `ui/dist/`. That is why, after changing code, you rebuild:

```bash
npx tsc && cd ui && npm run build
```

Content files in `content/` need **no** build step. They are read fresh from disk when the game launches.

---

## 4. What happens when the game boots

You start the game with:

```bash
npx electron dist/app/main.js
```

Here is the exact chain of events, in order:

1. **Electron starts the main process** and runs [dist/app/main.js](app/main.ts) (the compiled form of `app/main.ts`).
2. When Electron reports it is ready (`app.whenReady()`), the code calls two functions: `createWindow()` and `registerIPCHandlers()`.
3. **`createWindow()`** builds the game window: 1280 by 900 pixels, dark background. Two settings matter a lot here:
   - `contextIsolation: true` and `nodeIntegration: false`. These are the locks on the renderer's box (see [section 2](#program-2-the-renderer-the-stage)).
   - `preload: preload.js`. The preload script is the *one* piece of code allowed to stand in the doorway between the two worlds. More in [section 5](#5-how-the-two-halves-talk-the-bridge).
4. The window then loads the visible game. In production it loads the built web page from `ui/dist/index.html`. In development mode (`NODE_ENV=development`) it instead connects to a live development server at `http://localhost:5173`, which lets a developer see UI edits instantly without rebuilding.
5. Still inside `createWindow()`, the main process reads the world's structure from disk:
   - **`loadZoneGraph()`** opens [content/zones/act1/zones.json](content/zones/act1/zones.json) (the ordered list of zones with their titles and bosses), then looks inside each zone's folder and lists every lesson file it finds, sorted by filename. This becomes the world map.
   - **`loadSandpit()`** opens [content/sandpit/sandpit.json](content/sandpit/sandpit.json), the sandpit's table of contents, and loads each listed lesson's title.
   Nothing about the world is hardcoded: the map on screen is a direct reflection of what files exist in `content/`.
6. **`registerIPCHandlers()`** installs the answering machine: a list of named requests the renderer is allowed to make (`save:load`, `lesson:cast`, `combat:turn`, and so on). Each one is described in the next section.
7. Meanwhile the renderer side wakes up: [ui/src/main.tsx](ui/src/main.tsx) mounts the React app, [App.tsx](ui/src/App.tsx) shows the **title screen**, and a startup effect asks the main process for the zone graph and sandpit list so the world map will be ready.

From the title screen, the flow the player experiences is:

```
Title ──► Character creation ──► the sandpit (tutorial, mandatory lessons)
                                      │  (all mandatory lessons passed:
                                      │   level-up to 1, stone ceremony)
                                      ▼
                                 World map ──► Lesson screen ──► CAST loop
                                      │
                                      └────► Boss combat (some zones)
```

A brand-new character starts at **level 0** in the sandpit, and the world map refuses to open until the sandpit's mandatory lessons are passed. That gate lives in [WorldMapScreen.tsx](ui/src/components/WorldMapScreen.tsx) and the `sandpitComplete()` check in [store.ts](ui/src/store.ts).

---

## 5. How the two halves talk: the bridge

The renderer is locked in its box, so [app/preload.ts](app/preload.ts) builds it a telephone. Preload runs in a special privileged spot before the game page loads, and it publishes exactly one object into the page, called `window.gameapi`. Everything the visible game can ever ask of the outside world is on this object, and nothing else:

| Service | Calls | What it does |
|---|---|---|
| `gameapi.saves` | `list()`, `load(slot)`, `write(slot, data)`, `delete(slot)` | The three save slots. |
| `gameapi.lessons` | `load(lessonId, className)`, `cast({lessonId, playerCode, className})` | Fetch a lesson's text; compile-and-grade the player's code. |
| `gameapi.combat` | `start(...)`, `turn({action})`, `end()` | Run a boss fight, one turn at a time. |
| `gameapi.content` | `get(type)` | Fetch the zone graph, sandpit list, classes, or sprites. |

Each call is forwarded over **IPC** (inter-process communication, Electron's built-in question-and-answer channel) to a matching handler in [app/main.ts](app/main.ts). For example, `gameapi.lessons.cast(...)` in the window becomes the `lesson:cast` handler backstage. The renderer asks; the main process does the dangerous work and mails back a plain answer object, always shaped like `{ success: true, ...data }` or `{ success: false, error: "..." }`.

If you ever wonder "how does the pretty screen get X?", the answer is always: it called something on `window.gameapi`, which rang a handler in `app/main.ts`.

---

## 6. Screens and the game's memory (the store)

### One window, many screens

The game does not open new windows. Instead [App.tsx](ui/src/App.tsx) holds a single variable called `screen` and swaps what it draws based on its value. The full list of screens (from [store.ts](ui/src/store.ts)):

`title`, `save-select`, `character-creation`, `sandpit`, `world-map`, `lesson-encounter` (the lesson/code screen), `combat`, `spellbook`, `inventory`, `settings`.

Every "Back" or "Continue" button in the game is ultimately just a call to `setScreen("some-screen")`. Each screen is one file in [ui/src/components/](ui/src/components/).

### The store: one shared brain

React components normally each keep their own little memory, which becomes chaos in a game. So all game-wide state lives in a single shared object called the **store**, built with a small library called zustand: [ui/src/store.ts](ui/src/store.ts). It holds:

- `screen`: which screen is showing.
- `player`: name, class, level, XP, stats.
- `save` and `slot`: the full current save data and which of the 3 slots it belongs to.
- `zoneGraph` and `sandpit`: the world structure fetched at startup ([section 4](#4-what-happens-when-the-game-boots), step 7).
- `currentZoneId` / `currentLessonId` / `currentEncounterId`: what the player is doing right now.

It also holds the **actions**, the verbs of the game. The most important ones:

- `newGame(slot, name, class)`: builds a fresh save (level 0, empty spellbook) and drops the player into the sandpit.
- `selectLesson(zoneId, lessonId)`: records what was clicked and switches to the lesson screen.
- `recordAttempt(...)`: bumps the attempt counter for a lesson and remembers the player's code, every single CAST.
- `completeLesson(...)`: the reward ceremony. Marks the lesson passed, grants XP and items, adds any granted spell to the spellbook, recomputes the level (`level = 1 + floor(sqrt(xp / 100))`), updates zone status, and writes the save to disk.
- `zoneStatus(zoneId)`: decides locked/available/completed. The rule is simple: zone N unlocks when zone N minus 1 is completed.
- `sandpitComplete()`: true once every mandatory sandpit lesson is passed. This single function is the tutorial gate for the whole game.

One special rule worth knowing: in the sandpit, **optional lessons are deliberately zero-stakes**. `recordAttempt` and `completeLesson` both check for this and write nothing to the save. Failing or passing an optional sandpit lesson leaves no trace, on purpose. That is a design promise, not an accident.

---

## 7. The life of a CAST: what happens when you press the button

This is the most important pipeline in the game. Follow one press of the CAST button all the way down and back.

**Stage 1: the screen gathers the ingredients.** [LessonRunner.tsx](ui/src/components/LessonRunner.tsx) (the lesson screen) takes the code currently in the editor, bumps the attempt counter via `recordAttempt`, and calls `window.gameapi.lessons.cast({ lessonId, playerCode, className })`.

**Stage 2: the main process prepares the lesson.** The `lesson:cast` handler in [app/main.ts](app/main.ts) finds the lesson's YAML file (see [section 9](#9-how-the-game-finds-its-content) for how), and runs **substitution**: placeholders like `{{class_name}}`, `{{weapon}}`, and `{{starter_spell}}` in the lesson text are replaced with the player's actual class values from [content/classes.json](content/classes.json). A Warrior and a Mage genuinely read different lesson text. Then it hands everything to `runLesson()` in [runner/src/index.ts](runner/src/index.ts).

**Stage 3: assembly.** A lesson is not just the player's code. The runner glues together three parts into one complete C++ file:

```
prelude          (written by the lesson author: #include lines, main() opening, scene-setting)
player's code    (whatever is in the editor)
epilogue         (written by the lesson author: gameapi::report(...) calls, closing brace)
```

The player only ever sees and edits the middle. The prelude and epilogue are the lesson's hidden stagecraft. The assembled file is written to a fresh temporary folder as `main.cpp`.

There are two kinds of lesson, set by the `kind:` field:

- `kind: program`: the sandwich above. The player writes statements inside a `main()` the prelude opened.
- `kind: functions`: the player writes whole functions (like `int strike() { ... }`), and a pre-written **harness** file from [gameapi/](gameapi/) (named in the lesson's `harness:` field, e.g. `forge_attack_main.cpp`) supplies the `main()` that calls the player's functions and reports what they returned.

**Stage 4: compilation.** The runner invokes the real compiler:

```
g++ -std=c++17 -O0 -g0 -Wall  main.cpp  gameapi.cpp  [harness]  [extra units]  -o lesson.exe
```

`gameapi.cpp` is always compiled in, which is what gives player code access to `gameapi::report(...)` and friends. If compilation **fails**, the raw compiler complaint is matched against the error table in [runner/src/error_table.ts](runner/src/error_table.ts), which classifies it into a short id like `missing_semicolon` or `undeclared_identifier`. That id and the raw text go back up to the screen: the id can trigger a lesson hint, and [ui/src/lib/fet.ts](ui/src/lib/fet.ts) (the Friendly Error Translator) renders a plain-language explanation in the Errors tab. The pipeline stops here on a compile failure.

**Stage 5: caged execution.** If compilation succeeded, the program is run, but never directly. It runs under [toolchain/bin/sandbox_run](toolchain/bin/), a watchdog that enforces limits: how long it may run (3 seconds of wall-clock by default), how much processor time and memory it may use (2 seconds, 512 MB), and how much it may print (1 MB). A lesson can raise its own limits via a `limits:` field, but never beyond 10 times the default. This is why an accidental infinite loop in player code just produces a game message about a spell raging out of control instead of freezing the computer.

**Stage 6: reading the tea leaves.** The finished program's printed output is parsed line by line into three streams:

- Lines starting with `@@EV@@ ` are **game events**: JSON messages produced by the `gameapi` functions. For example, `gameapi::report("dummy_hp", 0)` in an epilogue prints `@@EV@@ {"type":"check","id":"dummy_hp","value":0}`. The player never sees these raw.
- The single line starting with `@@RESULT@@ ` is the sandbox's verdict: exit code, time used, and whether it had to kill the program.
- **Everything else** is the player's own `std::cout` output, shown to them verbatim in the Output tab.

**Stage 7: grading.** [runner/src/validator.ts](runner/src/validator.ts) walks the lesson's `validation.checks` list. There are exactly six check types:

| Check type | Passes when... |
|---|---|
| `exit_status` | the run ended the required way (`clean`, `nonzero`, `timeout`, `stack_overflow`, `access_violation`, `out_of_memory`, `output_flood`). Yes, some advanced lessons *require* a crash. |
| `check_equals` | a reported value (from `gameapi::report`) equals the expected value. |
| `check_in_range` | a reported value falls between `min` and `max`. |
| `stdout_contains` | the player's printed output contains an exact piece of text. |
| `stdout_matches` | the player's printed output matches a pattern (regular expression). |
| `event_emitted` | a particular game event occurred (a spell was cast, damage was dealt). |

All checks must pass for the lesson to pass.

**Stage 8: back up to the surface.** The result object returns through IPC to the lesson screen:

- **Pass:** the screen shows the success line, then calls `completeLesson(...)` on the store: XP, items, spell grants, level recalculation, save written to disk ([section 6](#6-screens-and-the-games-memory-the-store)).
- **Fail:** each failed check's message is shown, and the **hint ladder** is consulted. A lesson's hints have triggers of three forms: `error:<id>` (a specific compile error occurred), `check_failed:<id>` (a specific check failed), and `attempt:<n>` (the player has tried at least n times). Matching hints appear inline in the objective bar. After 5 attempts, a "Reveal a worked example" button also appears, showing the lesson's `solution:`.

That whole round trip, editor to compiler to sandbox to grader to reward, typically takes under a second.

---

## 8. Anatomy of a lesson file

Every lesson is one YAML file. YAML is a plain-text format where indentation shows structure and `|` means "a block of free text follows". Here is every field, using a real sandpit lesson ([content/sandpit/lesson-the-rope-dummy.yaml](content/sandpit/lesson-the-rope-dummy.yaml)) as the reference:

```yaml
id: sandpit-the-rope-dummy      # Unique name. The save file and the lesson-finder key on THIS,
                                # not the filename. Must be unique across the entire game.
kind: program                   # 'program' (player writes statements) or 'functions'
                                # (player writes whole functions; needs 'harness:').
zone: sandpit                   # Which zone it belongs to (matches the folder).
act: 1
title: "The Rope Dummy"         # What the player sees in lists and at the top of the screen.
concept: variables_and_types    # The C++ concept being taught (metadata).
concepts_required: [...]        # Concepts from earlier lessons this one leans on.

teaching: |                     # REQUIRED. The always-visible Guidance panel. Supports a tiny
  ...prose and a ```cpp code    # subset of markdown: ``` fenced code blocks, `code`, *em*,
  block...                      # **strong**. Must contain a worked example.

examples:                       # Optional extra worked variations shown under the teaching.
  - prompt: "..."
    code: |
      ...

narrative: |                    # The story beat for this lesson. Pure flavor, no mechanics.

objective: |                    # The task statement shown above the editor. This is the
                                # contract: what the player must make happen.

prelude: |                      # Hidden C++ pasted BEFORE the player's code.
starter_code: |                 # What the editor is pre-filled with.
epilogue: |                     # Hidden C++ pasted AFTER the player's code. Usually contains
                                # the gameapi::report(...) calls the checks depend on.

harness: forge_attack_main.cpp  # (kind: functions only) which gameapi/*_main.cpp supplies main().
extra_units: [leakcheck.cpp]    # (rare) extra hidden C++ files to compile in.
stdin_fixture: "..."            # (only for cin lessons) canned keyboard input.

solution: |                     # A correct answer. Shown via "Reveal a worked example" after
                                # 5 failed attempts, and compiled+run by the validation script
                                # to prove the lesson is actually solvable.

validation:
  checks:                       # The grading rules. See the six check types in section 7.
    - { type: exit_status, expect: clean }
    - { type: stdout_contains, id: struck, text: "I strike the dummy" }
    - { type: check_equals, id: dummy_hp, expected: 0 }

hints:                          # The hint ladder. Triggers: error:<compile-error-id>,
  - trigger: "attempt:2"        # check_failed:<check-id>, attempt:<n>.
    message: "..."

grants_spell:                   # Optional: passing adds a spell to the spellbook.
  name: "{{starter_spell}}"
  signature: "{{starter_spell}}"

rewards:
  xp: 0                         # XP granted on pass. Sandpit optional lessons use 0.
  unlocks_zone_progress: true
```

Anywhere in the text fields, the placeholders `{{class_name}}`, `{{weapon}}`, and `{{starter_spell}}` are substituted per class at load time ([section 7](#7-the-life-of-a-cast-what-happens-when-you-press-the-button), stage 2).

The formal definition of all this lives in [schemas/lesson.schema.json](schemas/lesson.schema.json), and `npm run lessons:validate` enforces it ([section 13](#13-scripts-tests-and-how-to-check-your-work)).

---

## 9. How the game finds its content

Three mechanisms, all in [app/main.ts](app/main.ts), and all reading straight from the `content/` folder on disk at launch:

**The zone graph.** [content/zones/act1/zones.json](content/zones/act1/zones.json) is the master list of zones: each entry has an `id` (which must match a folder name next to it), a `number` (0 through 9, which controls unlock order), a `title`, a `concept`, and optionally a `boss` (the id of an encounter file). The lessons *inside* a zone are not listed anywhere: the game simply reads the zone's folder and takes every `*.yaml` file that does not start with `encounter-`, **sorted by filename**. That filename sort is why lessons are named `zone-2-lesson-1.yaml`, `zone-2-lesson-2.yaml`, and so on: the filename is the ordering.

**The sandpit manifest.** The sandpit is different: [content/sandpit/sandpit.json](content/sandpit/sandpit.json) explicitly lists its lesson files in display order, each with a `mandatory` flag. Mandatory lessons gate the world map and unlock one at a time, in order. Optional ones are free practice, only playable after the mandatory set is done.

**The lesson finder.** When anything asks for a lesson by id (`lesson:load`, `lesson:cast`, `combat:start`), the function `findLessonFile()` walks every YAML file under `content/zones/` and `content/sandpit/`, opens each, and returns the first whose `id:` field matches. Two consequences worth memorizing:

1. The filename and the id are independent. The manifest and folders use filenames; saves and the running game use ids.
2. **Ids must be unique across the whole game.** If two files share an id, whichever the walk reaches first silently wins.

---

## 10. Saving and loading

Save handling lives in [app/saves.ts](app/saves.ts). The essentials:

- There are **three save slots**, stored as `slot1.json`, `slot2.json`, `slot3.json` inside Electron's per-user data folder (on Linux: `~/.config/quest-for-data-codebase/saves/`). Plain JSON; you can open one in a text editor and read it.
- A save contains: the player (name, class, level, xp, stats), per-zone progress (each lesson's status, attempt count, and **the player's last code**, which is why reopening a passed lesson shows your own solution), the spellbook, inventory, and a settings snapshot.
- **Writes are atomic**: the save is first written to a temporary file, then renamed over the real one. A crash or power cut mid-save can never leave you with half a file.
- **Corruption is quarantined, not destroyed**: if a save fails to parse or fails schema validation on load, it is copied to `slotN.json.corrupt.json` and the slot reports itself corrupted, so nothing is silently lost.
- Every save is validated against the expected shape both before writing and after reading.
- The environment variable `QUEST_USER_DATA` redirects the whole save folder. The automated tests use this so robot playthroughs never touch your real saves.

When does the game save? On character creation, and inside `completeLesson`/`completeBoss` in the store. Passing things saves; there is no manual save button.

---

## 11. Combat and boss fights

Some zones end in a boss (`boss:` field in `zones.json`, pointing at an `encounter-*.yaml` file in the zone folder, e.g. [encounter-forge-wraith.yaml](content/zones/act1/function_forge/encounter-forge-wraith.yaml)). When the world map shows the boss entry and the player clicks it, the flow is:

1. The store's `startEncounter(...)` switches to the `combat` screen ([CombatScreen.tsx](ui/src/components/CombatScreen.tsx)).
2. The screen calls `gameapi.combat.start(...)`, passing the encounter id and, importantly, **the player's spellbook from the save**. The spells you forged in lessons are literally the moves you have in combat.
3. Backstage, `combat:start` reads the encounter YAML (enemy HP, damage ranges, and special fields like the Leak Tyrant's `grow_hp_per_turn`), builds a combat state, and writes it to a temporary folder.
4. Each player action calls `combat:turn`. Here is the fun part: **the combat math is not done in TypeScript.** Each turn, the runner ([runner/src/combat.ts](runner/src/combat.ts)) generates a small C++ program that includes the player's spell signatures, compiles it, and runs it in the same sandbox as lessons. The C++ program prints `@@EV@@` events (damage dealt, spells cast) and the updated state; the screen just animates whatever events come back.
5. `combat:end` deletes the temporary folder. Victory routes through the store's `completeBoss(...)`: boss marked defeated, zone completed, XP granted, save written.

One session at a time, held in a single `activeCombat` variable in `app/main.ts`.

---

## 12. How to add a new sandpit lesson (step by step)

The concrete walkthrough. Goal: a test lesson that is a clone of the newest sandpit lesson, The Rope Dummy. Total work: one copied file, two edited lines, one added manifest line. **No code, no rebuild.**

**Step 1: copy the lesson file.**

```bash
cd content/sandpit
cp lesson-the-rope-dummy.yaml lesson-the-rope-dummy-2.yaml
```

**Step 2: give the copy its own identity.** Open the new file and change exactly two lines:

```yaml
id: sandpit-the-rope-dummy-2        # was: sandpit-the-rope-dummy
title: "The Rope Dummy II"          # was: "The Rope Dummy"
```

The `id` change is the critical one. Remember [section 9](#9-how-the-game-finds-its-content): ids must be unique across the entire game, and if you skip this, the game will treat your clone and the original as the same lesson, with confusing results (shared pass status, the finder returning whichever file it hits first).

**Step 3: register it in the sandpit manifest.** Open [content/sandpit/sandpit.json](content/sandpit/sandpit.json) and add one line to the `lessons` array. Order in this array is display order, so put it where you want it to appear:

```json
{ "file": "lesson-the-rope-dummy-2.yaml", "mandatory": false }
```

Keep `"mandatory": false` for a test lesson. Marking it `true` would add it to the tutorial gate: every new character would have to pass it before the world map opens, and it would grant real saved progress.

Mind the commas: every entry except the last needs a trailing comma, and the last must not have one. A stray comma makes the whole file unreadable and the sandpit will come up empty.

**Step 4: verify it.**

```bash
npm run lessons:validate
```

This script automatically discovers everything in the sandpit manifest (plus Zones 0 through 2), checks your YAML against the lesson schema, and, best of all, **compiles and runs your lesson's `solution:` through the real pipeline** to prove the lesson is actually solvable. If your clone validates, it works.

**Step 5: play it.** Restart the game (content is read at launch, so a running game will not see the new file until relaunched):

```bash
npx electron dist/app/main.js
```

Your lesson appears in the sandpit under Free practice. Because it is optional, it is zero-stakes: attempts and passes write nothing to the save, by design.

**To remove it later:** delete the YAML file and its manifest line. Nothing else references it.

**Adding a lesson to a numbered zone instead** is nearly the same, with two differences: there is no manifest (just drop the file in the zone's folder, e.g. `content/zones/act1/function_forge/`), and the **filename controls its position**, so name it to sort where it belongs (`zone-2-lesson-6.yaml` goes after lesson 5). Zone lessons should carry real `rewards.xp` and full hint ladders, and note that `npm run lessons:validate` currently auto-checks Zones 0 through 2 plus the sandpit.

---

## 13. Scripts, tests, and how to check your work

All of these run from the repository root.

| Command | What it does |
|---|---|
| `npx tsc` | Rebuilds the backstage code (`app/`, `runner/`, `scripts/`) into `dist/`. Needed after editing any `.ts` file outside `ui/`. |
| `cd ui && npm run build` | Rebuilds the visible game into `ui/dist/`. Needed after editing anything in `ui/src/`. |
| `npx electron dist/app/main.js` | Launches the game. |
| `npm run lessons:validate` | The content author's best friend: schema-checks and solution-runs every lesson in Zones 0 to 2 and the sandpit. |
| `npm run content:validate` | Validates the JSON content files (classes, zones, sprites) against their schemas. |
| `npx vitest run` | Runs the unit test suite (the runner, validator, combat math, save handling, and more). |
| `npm run accept:phase0` ... `accept:phase4` | The acceptance suites for each historical build phase; each independently re-verifies that phase's promises. |
| `xvfb-run -a npx ts-node scripts/e2e-drive.ts --max-zone 9 --class warrior` | The robot playtester: launches the real game invisibly and plays it, sandpit ceremony, every lesson, every boss, checking saves along the way. The strongest "everything still works" signal in the repo. |

A sensible habit after any change: rebuild if you touched code, then `npm run lessons:validate` if you touched content, then `npx vitest run`, and for big changes, the e2e drive.

---

## 14. Glossary

- **Electron**: a framework for building desktop apps out of web technology. Provides the window, the main process, and IPC.
- **Main process**: the privileged backstage program ([app/main.ts](app/main.ts)) with full computer access.
- **Renderer**: the sandboxed program that draws the window; our React app in [ui/](ui/).
- **Preload / context bridge**: the doorway script ([app/preload.ts](app/preload.ts)) that publishes `window.gameapi`, the renderer's only telephone line to the main process.
- **IPC**: inter-process communication; Electron's named question-and-answer channels (`lesson:cast`, `save:write`, ...).
- **React**: a library for building user interfaces out of components (each screen is one).
- **zustand / the store**: the single shared state object ([ui/src/store.ts](ui/src/store.ts)) holding the player, save, and current screen.
- **Monaco**: the code editor component in the lesson screen (the same editor engine as VS Code), bundled locally.
- **TypeScript**: JavaScript with type labels; compiled to JavaScript by `npx tsc` into `dist/`.
- **YAML**: the human-friendly text format lessons are written in.
- **JSON**: the stricter text format used for manifests, saves, and events.
- **g++**: the real C++ compiler that builds the player's code.
- **Harness**: a pre-written C++ `main()` file in [gameapi/](gameapi/) used by `kind: functions` lessons to call the player's functions.
- **gameapi (C++)**: the small library compiled into every player program; its functions (like `gameapi::report`) print `@@EV@@` event lines the game reads.
- **`@@EV@@` / `@@RESULT@@`**: sentinel prefixes separating machine-readable events and the run verdict from the player's own printed output.
- **sandbox_run**: the watchdog binary that runs player programs under time, memory, and output limits.
- **FET (Friendly Error Translator)**: the two-part system (classifier in [runner/src/error_table.ts](runner/src/error_table.ts), phrasing in [ui/src/lib/fet.ts](ui/src/lib/fet.ts)) that turns raw compiler errors into readable messages and hint triggers.
- **Hint ladder**: a lesson's escalating hints, triggered by specific errors, specific failed checks, or attempt counts.
- **Zone graph**: the world structure built at boot from `zones.json` plus the lesson files on disk.
- **The sandpit**: the tutorial zone; mandatory lessons gate the world, optional ones are zero-stakes practice.
- **Atomic write**: writing to a temporary file then renaming, so a crash can never half-write a save.
