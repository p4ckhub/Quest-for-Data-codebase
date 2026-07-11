# Phase 1 Bugs

## Electron preload path resolves to nested `app/app/preload.js` (fixed)

`app/main.ts` builds the preload script path as `path.join(__dirname, 'app/preload.js')`. At runtime `__dirname` is already `dist/app`, and `preload.js` is compiled directly into that same folder (`dist/app/preload.js`) — there is no nested `app/` subdirectory. This made Electron fail to load the preload script with:

```
Unable to load preload script: .../dist/app/app/preload.js
Error: ENOENT: no such file or directory, open '.../dist/app/app/preload.js'
```

Fix: use `path.join(__dirname, 'preload.js')` instead.

## `CharacterCreationScreen.tsx` fails to resolve `content/classes.json` (fixed)

`ui/src/components/CharacterCreationScreen.tsx` imported the classes data as `../../content/classes.json`. That path works from `ui/src/store.ts` and `ui/src/sprites.tsx` (two levels up from `ui/src/` reaches the project root), but `CharacterCreationScreen.tsx` lives one directory deeper at `ui/src/components/`, so two levels up only reached `ui/` — there is no `ui/content/`. Vite failed with:

```
[plugin:vite:import-analysis] Failed to resolve import "../../content/classes.json" from "src/components/CharacterCreationScreen.tsx". Does the file exist?
```

Fix: use `../../../content/classes.json` (three levels up) instead.

## "New Game" and "Settings" buttons on the title screen do nothing (fixed)

`ui/src/App.tsx` rendered `TitleScreen` with `onNewGame={() => {}}`, `onSaveSelect={() => {}}`, and `onSettings={() => {}}` — all stubbed as no-ops instead of navigating anywhere. The buttons were clickable but had no effect since the handlers did nothing.

Fix: wired the handlers to the store's `setScreen` action — `onNewGame` → `setScreen("character-creation")`, `onSettings` → `setScreen("settings")`, `onSaveSelect` → `setScreen("world-map")`.

## Lesson code editor never actually mounts (fixed)

`ui/src/components/LessonRunner.tsx` manually injected a `<script>` tag to load Monaco from a CDN (`cdnjs.cloudflare.com`) and, once loaded, rendered an empty `<div id="monaco-editor">` — but no code anywhere called `monaco.editor.create(...)` to attach an editor instance to that div. So even on a successful CDN load, the code editor pane stayed permanently blank with no error, since nothing technically failed. There was also no `script.onerror` handler, so a blocked/offline CDN request would silently leave the UI stuck on "Loading code editor..." forever with zero console output.

The project already has `@monaco-editor/react` and `monaco-editor` installed as npm dependencies, making the CDN approach unnecessary.

Fix: replaced the manual script-injection logic with the `Editor` component from `@monaco-editor/react`, bundled locally instead of fetched from a CDN, with `language="cpp"`, wired to `state.code` / `handleEditorChange`.

## `lesson:cast` IPC handler always throws (fixed)

`app/main.ts` looked up the player's class with `contentCache.classes.find((c) => c.id === params.className)`, but `content/classes.json` stores classes as an object keyed by class id (`{ "warrior": {...}, "archer": {...} }`), not an array — `.find` doesn't exist on a plain object, so this threw a `TypeError` on every cast attempt, caught and surfaced as a generic error.

Fix: replaced the `.find()` call with a direct property lookup, `contentCache.classes[params.className]`.

## Lesson content paths and filename assumptions were both wrong (fixed)

Two stacked bugs in `app/main.ts` produced `Lesson not found: awakening-101` when hitting CAST:

1. **Wrong directory depth.** `loadZoneGraph()`, `lesson:load`, `lesson:cast`, and `content:get` (`zone` type) all built paths as `path.join(__dirname, '../content/zones/...')`. At runtime `__dirname` is `dist/app`, so `../content` resolves to `dist/content` — but the lesson YAML files were never copied there (only `classes.json`/`sprites.json` get copied into `dist/content`, and only because they're statically `import`ed with `resolveJsonModule`, which TypeScript copies at compile time). The real `content/zones/` only exists at the project root, two levels up from `dist/app`, not one.
2. **Filename didn't match lesson id.** Even after fixing the path depth, `lesson:load`/`lesson:cast` built the file path as `${lessonId}.yaml` (e.g. `awakening-101.yaml`) and hardcoded the zone folder to `act1/character_creation`. But content files are named `zone-0-lesson-1.yaml`, `zone-1-lesson-1.yaml`, etc. — the lesson's `id:` field (e.g. `awakening-101`) is internal to the file, not its filename. So no file would ever match, and lessons living in other zones (e.g. `forge-strike-warrior` in `function_forge`) could never load regardless.

Fix: added `findLessonFile(lessonId)`, which recursively walks `content/zones/` (using the corrected `../../content/zones` root), parses each `.yaml` file, and returns the path of the one whose `id:` field matches — used by both `lesson:load` and `lesson:cast` instead of guessing a path from the id.

## UI production build failed: `WorldNode` type mismatch (fixed)

`ui/src/components/WorldMapScreen.tsx` declared its own local `WorldNode` interface with `name: string` and `lessonId?: string`, while the store's exported `WorldNode` (`ui/src/store.ts`) lacked both fields. Passing store nodes into `handleNodeClick(node: WorldNode)` and rendering `node.name` failed `tsc` during `npm run build`:

```
src/components/WorldMapScreen.tsx(40,44): error TS2345 ... Property 'name' is missing
src/components/WorldMapScreen.tsx(48,25): error TS2339: Property 'name' does not exist on type 'WorldNode'
```

Fix: added `name: string` and `lessonId?: string` to the store's `WorldNode` and made `WorldMapScreen.tsx` import that type instead of redefining it.

## Monaco was still loading from a CDN despite the earlier "bundled locally" fix (fixed)

The previous fix swapped the manual `<script>` injection for `@monaco-editor/react`'s `Editor` component — but that component's default loader **still downloads monaco from the jsdelivr CDN at runtime**. Nothing in the repo called `loader.config({ monaco })`, so in an offline Electron app the editor pane would sit on "Loading code editor..." forever; it only ever worked with internet access.

Fix: added `ui/src/monaco-setup.ts`, which imports the locally installed `monaco-editor` package (deep import `monaco-editor/esm/vs/editor/editor.main.js`, since monaco-editor@0.45 only declares a `module` entry that vitest's resolver won't honor), registers the base editor worker via `self.MonacoEnvironment` (C++ needs no dedicated language worker), and calls `loader.config({ monaco })`. `LessonRunner.tsx` imports this module before `Editor`. The bundle grows from ~172 kB to ~3.3 MB — that's monaco actually being bundled. For jsdom tests, `vite.config.ts` aliases `monaco-setup` to an empty stub (`tests/ui/monaco-setup-stub.ts`) because the full monaco bundle can't execute under jsdom (`document.queryCommandSupported` etc.); this also un-blocked the whole `tests/ui/lesson-runner.test.tsx` suite, which previously failed at import analysis (7 tests never ran).

## Built UI unloadable in production: wrong path in `loadFile` + absolute asset URLs (fixed)

Two stacked bugs meant the packaged app could never display the UI:

1. `app/main.ts` loaded `path.join(__dirname, '../ui/dist/index.html')` — `__dirname` is `dist/app` at runtime, so this resolved to `dist/ui/dist/index.html`, which doesn't exist (the vite build output lives at the project root, `ui/dist/`). Fix: `../../ui/dist/index.html`.
2. `ui/vite.config.ts` had no `base` option, so the built `index.html` referenced assets as `/assets/index-*.js` — absolute paths that resolve to the filesystem root under `file://`, producing a permanently blank window even once the HTML itself loaded. Fix: `base: './'` so asset URLs are relative.

## `lesson:cast` always returned "Class not found" (fixed)

The earlier fix replaced `.find()` with `contentCache.classes[params.className]`, but `content/classes.json` is shaped `{ "version": ..., "classes": { "warrior": {...}, ... } }` — the cache stored the **whole file**, so the lookup indexed the wrong level (`json["warrior"]` instead of `json.classes["warrior"]`) and every cast failed with `Class not found: warrior`. Fix: `contentCache` now stores the unwrapped inner maps (`(classesJson as any).classes`, `(spritesJson as any).sprites`). (Nothing else consumed `content:get('classes')`, so unwrapping is safe.)

Related: `LessonRunner.tsx` used `player?.class || "Warrior"` as its fallback class id, but class ids are lowercase (`warrior`/`archer`/`mage`) — the capital-W fallback could never match. Fixed to `"warrior"`. (The real player flow was fine: character creation stores the lowercase key.)

## CAST failed at compile: runner resolved the toolchain inside `dist/` (fixed)

`runner/src/index.ts` computed `TOOLCHAIN_DIR = path.join(__dirname, '../../toolchain')`. That's correct when the module runs from source (`runner/src`, as vitest/ts-node do), but the Electron main process loads the **compiled** copy at `dist/runner/src/index.js`, where the same relative hop lands on `dist/toolchain`. A stray `dist/toolchain/toolchain.lock.json` made the compiler lookup appear to work, but the compile then failed with:

```
fatal error: gameapi.h: No such file or directory
cc1plus: fatal error: .../dist/gameapi/gameapi.cpp: No such file or directory
```

No single relative depth works for both locations. Fix: `findProjectRoot()` walks up from `__dirname` until it finds `toolchain/bin/sandbox_run` (the lock file alone is not a safe marker precisely because `dist/` carries a copy) and anchors `TOOLCHAIN_DIR` there. After this, `lesson:cast` compiles player code with g++ and runs it under `sandbox_run` successfully end-to-end.

## Monaco editor pane collapsed to zero height (fixed)

In `ui/src/styles.css`, `.console-panel` had `height: 100%` while sitting in the same flex column (`.forge-panel`) as the editor. The console demanded the full panel height, so the flexible `.code-editor-container { flex: 1 }` above it was squeezed to ~0px — the editor mounted fine but was invisible. Fix: console panel now uses `flex: 0 0 auto; max-height: 45%; overflow-y: auto`, and the editor container got `min-height: 200px`.

## Lesson text displayed raw `{{class_name}}` placeholders (fixed)

`lesson:cast` substituted template variables before compiling, but `lesson:load` returned the raw YAML — so the objective bar and narrative box literally showed `As a {{class_name}}, I enter the fray!`. Fix: `lesson:load` now accepts an optional `className` and applies the same `substituteVariables()`; `preload.ts`, `ui/src/types/gameapi.ts`, and `LessonRunner.tsx` pass the player's class through.

---

## Verification (2026-07-10)

- `npx tsc` — production code compiles clean (remaining diagnostics are pre-existing test-file typing noise: vitest globals not in root tsconfig `types`).
- `cd ui && npm run build` — passes.
- `npx vitest run` — **11 files / 94 tests, all passing** (up from 87: the lesson-runner UI suite was previously failing to even load).
- Playwright-driven Electron smoke test (real `dist/app/main.js` under xvfb): title screen → New Game → create Warrior → world map → lesson screen; lesson narrative/objective load with substitutions applied; Monaco mounts offline; `lesson:cast` with the lesson's solution code compiles via g++ and executes under `sandbox_run` returning `success: true, exit_code=0`.
- Note for local runs: launching Electron from a Claude Code shell requires clearing `ELECTRON_RUN_AS_NODE` (the harness sets it to 1, which makes the Electron binary act as plain Node and crash on `app.whenReady`). Not a codebase bug.
