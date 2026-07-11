// Point @monaco-editor/react at the locally installed monaco-editor package.
// Without loader.config({ monaco }) it fetches monaco from the jsdelivr CDN at
// runtime, which hangs forever in an offline Electron app.
// Deep import: monaco-editor@0.45 declares only a "module" entry, which
// vitest's resolver doesn't honor; the explicit file path works everywhere.
import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// C++ has no dedicated language worker; the base editor worker handles it.
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

loader.config({ monaco });

// Expose for the E2E acceptance driver (and devtools debugging): lets tests
// set editor content directly instead of simulating keystrokes.
(window as any).monaco = monaco;
