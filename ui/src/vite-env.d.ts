/// <reference types="vite/client" />

// monaco-editor's ESM build ships no .d.ts alongside editor.main.js;
// its API surface is the same as the package root's declarations.
declare module "monaco-editor/esm/vs/editor/editor.main.js" {
  export * from "monaco-editor";
}
