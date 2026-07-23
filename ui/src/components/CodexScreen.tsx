import React from "react";
import { useGameStore } from "../store";
import codexData from "../../../content/codex.json";

// The Codex (an ancient in-world textbook): the player-facing reference for the
// gameapi surface. Sourced from content/codex.json so new castings are authored
// as data, never hard-coded here. Opened from a hub (sandpit / world map) via
// openCodex(), which remembers where to return.

interface Casting {
  name: string;
  signature: string;
  gloss: string;
  judged?: boolean;
  rubric?: string;
}

interface CodexData {
  title: string;
  epigraph: string;
  castings: Casting[];
  colophon: string;
}

const codex = codexData as CodexData;

export const CodexScreen: React.FC = () => {
  const { codexReturn, setScreen } = useGameStore();

  // Split a "name(args)" signature so the name can be rubricated and the args
  // set in an aside register — the call name is the word that matters.
  const renderSignature = (sig: string) => {
    const m = /^([^(]+)(\(.*\))$/.exec(sig);
    if (!m) return <span className="codex-nm">{sig}</span>;
    return (
      <>
        <span className="codex-nm">{m[1]}</span>
        <span className="codex-ar">{m[2]}</span>
      </>
    );
  };

  return (
    <div className="codex-screen">
      <div className="codex-book">
        <div className="codex-ribbon" />
        <div className="codex-head">
          <span className="codex-sm">Opened from your pack ✶</span>
          <span className="codex-title">{codex.title}</span>
        </div>
        <p className="codex-epigraph">“{codex.epigraph}”</p>

        <div className="codex-entries">
          {codex.castings.map((c) => (
            <div className="codex-entry" key={c.name}>
              <div className="codex-drop">{c.name.charAt(0).toUpperCase()}</div>
              <div className="codex-entry-body">
                <div className="codex-cast">{renderSignature(c.signature)}</div>
                <div className="codex-gloss">
                  {c.judged && c.rubric && <span className="codex-rubric">{c.rubric} </span>}
                  {c.gloss}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="codex-colophon">{codex.colophon}</div>
      </div>

      <button className="btn codex-back" onClick={() => setScreen(codexReturn)}>
        Close the Codex
      </button>
    </div>
  );
};

export default CodexScreen;
