import React from "react";
import { useGameStore } from "../store";

// The sandpit's opening: a required-reading welcome shown once, at the very
// start of the sandpit, before any lesson. No casting here — it hands the
// player their instruments (the Forge, the Codex) and two words (cast, trial),
// then steps aside. Acknowledged with Continue, which persists to the save so
// it never nags again; the Codex stays reachable afterward.

export const SandpitIntro: React.FC = () => {
  const { markIntroSeen, openCodex } = useGameStore();

  return (
    <div className="sandpit-intro-screen">
      <div className="forerunner-scene">
        <span className="forerunner-figure">
          — a figure wearing your own face, aged a thousand lifetimes —
        </span>
      </div>

      <div className="forerunner-body">
        <div className="forerunner-speaker">The Forerunner</div>

        <p className="forerunner-line">
          “Before you cast, know your instruments. This is the{" "}
          <span className="tool-forge">Forge</span> — here your will takes shape as a
          line of speech. The realm has already laid the stone around your words;
          the parts greyed are <em>mine</em> to hold, not yours to change. You need
          only speak the line that is yours.”
        </p>

        <p className="forerunner-line">
          “And this —{" "}
          <button className="tool-codex-link" onClick={openCodex}>
            ✶ the Codex
          </button>{" "}
          — is a book older than the ruins. Every casting the realm still remembers
          is written in it. When a word slips from you, do not guess.{" "}
          <em>Open it.</em> I did, once, for a hundred years.”
        </p>

        <p className="forerunner-line">
          “Two words, then, and we begin: a <span className="tool-forge">cast</span> is
          a line you speak; a <span className="tool-forge">trial</span> is the realm
          deciding whether it heard what it hoped. Now — read on, and we start.”
        </p>

        <div className="forerunner-actions">
          <button className="btn cast-btn" onClick={markIntroSeen}>
            Continue ➜
          </button>
          <button className="btn" onClick={openCodex}>
            ✶ Peek at the Codex
          </button>
        </div>
      </div>
    </div>
  );
};

export default SandpitIntro;
