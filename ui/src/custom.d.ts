// Custom type declarations for global window object

import { GameAPI } from "./types/gameapi";

declare global {
  interface Window {
    gameapi: GameAPI;
    monaco?: any;
    require?: {
      config: (config: any) => void;
      (deps: string[], callback: any): void;
    };
  }
}

// JSON module declarations
declare module "*.json" {
  const value: any;
  export default value;
}

export {};
