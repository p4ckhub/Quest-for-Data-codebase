import React, { useState, useEffect } from "react";
import "../monaco-setup";
import Editor from "@monaco-editor/react";
import { useGameStore } from "../store";
import { translateError } from "../lib/fet";

interface Hint {
  trigger: string;
  message: string;
}

interface LessonData {
  id: string;
  title?: string;
  teaching?: string;
  examples?: Array<{ prompt: string; code: string }>;
  narrative?: string;
  objective?: string;
  starter_code?: string;
  solution?: string;
  hints?: Hint[];
  rewards?: { xp?: number; items?: Array<{ item_id: string; count: number }> };
  grants_spell?: { name: string; signature: string };
}

// Render a teaching block: fenced ``` sections become code blocks, the prose
// between them gets minimal markdown (`code`, *em*, **strong**). No external
// markdown lib — teaching content is authored in-repo and this subset is enough.
export function renderTeachingParts(text: string): Array<{ kind: "prose" | "code"; content: string }> {
  const parts: Array<{ kind: "prose" | "code"; content: string }> = [];
  const segments = text.split(/```(?:\w+)?\n?/);
  segments.forEach((seg, i) => {
    const content = i % 2 === 1 ? seg.replace(/\n$/, "") : seg.trim();
    if (content) parts.push({ kind: i % 2 === 1 ? "code" : "prose", content });
  });
  return parts;
}

const proseSpans = (line: string): React.ReactNode[] =>
  line.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((tok, i) => {
    if (tok.startsWith("`") && tok.endsWith("`")) return <code key={i}>{tok.slice(1, -1)}</code>;
    if (tok.startsWith("**") && tok.endsWith("**")) return <strong key={i}>{tok.slice(2, -2)}</strong>;
    if (tok.startsWith("*") && tok.endsWith("*")) return <em key={i}>{tok.slice(1, -1)}</em>;
    return tok;
  });

const TeachingBlock: React.FC<{ teaching: string; examples?: Array<{ prompt: string; code: string }> }> = ({ teaching, examples }) => (
  <div className="teaching-panel">
    <h4>✦ Guidance</h4>
    {renderTeachingParts(teaching).map((part, i) =>
      part.kind === "code" ? (
        <pre key={i} className="teaching-code">{part.content}</pre>
      ) : (
        part.content.split(/\n\n+/).map((para, j) => (
          <p key={`${i}-${j}`}>{proseSpans(para.replace(/\n/g, " "))}</p>
        ))
      )
    )}
    {examples && examples.length > 0 && (
      <div className="teaching-examples">
        {examples.map((ex, i) => (
          <div key={i} className="teaching-example">
            <p><em>{ex.prompt}</em></p>
            <pre className="teaching-code">{ex.code}</pre>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface TranslatedError {
  message: string;
  hint?: string;
}

interface RunnerState {
  code: string;
  attempts: number;
  isCasting: boolean;
  outputTab: "output" | "errors" | "raw";
  output: string[];
  errors: TranslatedError[];
  rawOutput: string;
  passed: boolean;
  alreadyPassed: boolean;
  activeHints: string[];
  showSolution: boolean;
}

const LessonRunnerScreen: React.FC = () => {
  const { player, save, currentZoneId, currentLessonId, setScreen, completeLesson, recordAttempt } = useGameStore();
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [state, setState] = useState<RunnerState>({
    code: "",
    attempts: 0,
    isCasting: false,
    outputTab: "output",
    output: [],
    errors: [],
    rawOutput: "",
    passed: false,
    alreadyPassed: false,
    activeHints: [],
    showSolution: false,
  });

  // Load the lesson selected on the world map
  useEffect(() => {
    const loadLesson = async () => {
      if (!currentLessonId) return;
      try {
        const result = await window.gameapi?.lessons?.load(currentLessonId, player?.class || "warrior");
        if (result?.success && result.lesson) {
          const data = result.lesson as LessonData;
          setLesson(data);
          // Reopening a passed lesson shows the player's own solution (§13)
          const saved = currentZoneId
            ? save?.zones[currentZoneId]?.lessons[currentLessonId]
            : undefined;
          setState((prev) => ({
            ...prev,
            code: saved?.player_region || data.starter_code || "",
            attempts: saved?.attempts ?? 0,
            alreadyPassed: saved?.status === "passed",
            passed: false,
            output: [],
            errors: [],
            rawOutput: "",
            activeHints: [],
            showSolution: false,
          }));
        }
      } catch (e) {
        console.error("Failed to load lesson:", e);
      }
    };
    loadLesson();
  }, [currentLessonId]);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setState((prev) => ({ ...prev, code: value }));
    }
  };

  // Hint ladder (§11.3): error:<id>, check_failed:<id>, attempt:<n>
  const collectHints = (attempts: number, errorId?: string, failedCheckIds?: string[]): string[] => {
    const hints = lesson?.hints ?? [];
    const active: string[] = [];
    for (const hint of hints) {
      if (errorId && hint.trigger === `error:${errorId}`) active.push(hint.message);
      for (const id of failedCheckIds ?? []) {
        if (hint.trigger === `check_failed:${id}`) active.push(hint.message);
      }
      if (hint.trigger.startsWith("attempt:")) {
        const n = parseInt(hint.trigger.split(":")[1], 10);
        if (attempts >= n) active.push(hint.message);
      }
    }
    return active;
  };

  const handleCast = async () => {
    if (!lesson || !currentLessonId) return;
    setState((prev) => ({ ...prev, isCasting: true }));
    const attempts = state.attempts + 1;
    recordAttempt(currentLessonId, state.code);

    try {
      const result = await window.gameapi?.lessons?.cast({
        lessonId: currentLessonId,
        playerCode: state.code,
        className: player?.class || "warrior",
      });

      if (result?.compileError) {
        const translated = translateError(result.compileError).map((t: any) => ({
          message: t.friendlyMessage,
          hint: t.hint,
        }));
        setState((prev) => ({
          ...prev,
          isCasting: false,
          attempts,
          outputTab: "errors",
          errors: translated,
          rawOutput: result.compileError,
          activeHints: collectHints(attempts, result.errorId),
        }));
        return;
      }

      const outputLines: string[] = [];
      if (result?.rawStdout) outputLines.push(...result.rawStdout.split("\n"));
      for (const ev of result?.events ?? []) {
        if (ev.type === "log" && ev.msg) outputLines.push(`✦ ${ev.msg}`);
      }

      if (result?.passed) {
        setState((prev) => ({
          ...prev,
          isCasting: false,
          attempts,
          outputTab: "output",
          output: [...outputLines, "", "★ The incantation holds. Objective complete!"],
          rawOutput: result.output ?? "",
          passed: true,
          errors: [],
          activeHints: [],
        }));
        await completeLesson(
          { id: lesson.id, rewards: lesson.rewards, grants_spell: lesson.grants_spell },
          state.code
        );
      } else {
        const failMessages = (result?.checks ?? [])
          .filter((c: any) => !c.passed)
          .map((c: any) => c.message)
          .filter(Boolean);
        if (result?.error) failMessages.unshift(result.error);
        setState((prev) => ({
          ...prev,
          isCasting: false,
          attempts,
          outputTab: "output",
          output: [...outputLines, "", ...failMessages.map((m: string) => `✗ ${m}`)],
          rawOutput: result?.output ?? "",
          errors: [],
          activeHints: collectHints(attempts, result?.errorId, result?.failedCheckIds),
        }));
      }
    } catch (e: any) {
      setState((prev) => ({
        ...prev,
        isCasting: false,
        attempts,
        outputTab: "errors",
        errors: [{ message: e.message || "Unknown error" }],
        rawOutput: String(e),
      }));
    }
  };

  if (!currentLessonId) {
    return (
      <div className="lesson-runner-screen">
        <p>No lesson selected.</p>
        <button className="btn" onClick={() => setScreen("world-map")}>World Map</button>
      </div>
    );
  }

  return (
    <div className="lesson-runner-screen">
      {/* Left: Game Panel */}
      <div className="game-panel">
        <h3>{lesson?.title ?? "Lesson"}</h3>
        <div className="scene-canvas">
          {state.passed || state.alreadyPassed ? "✨ The chamber glows with completed magic." : "The chamber awaits your incantation."}
        </div>
        {/* Teaching Panel — always visible, above the narrative (PHASE1.5 §3) */}
        {lesson?.teaching && <TeachingBlock teaching={lesson.teaching} examples={lesson.examples} />}
        {/* Narrative Box */}
        <div className="narrative-box">
          <p>{lesson?.narrative || ""}</p>
          {state.attempts >= 5 && lesson?.solution && !state.passed && (
            <div className="solution-reveal">
              {state.showSolution ? (
                <pre style={{ background: "#10102a", padding: "0.5rem", fontSize: "0.8rem" }}>{lesson.solution}</pre>
              ) : (
                <button className="btn" onClick={() => setState((p) => ({ ...p, showSolution: true }))}>
                  Reveal a worked example
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Forge Panel */}
      <div className="forge-panel">
        {/* Hints render inline at the top of the prompt (PHASE1.5 §3):
            <objective> (HINT: <the-hint>) */}
        <div className="objective-bar">
          <h4>
            {lesson?.objective || "Lesson Objective"}
            {state.activeHints.map((hint, i) => (
              <span key={i} className="hint-inline"> (HINT: {hint})</span>
            ))}
          </h4>
        </div>

        <div className="code-editor-container">
          <Editor
            height="100%"
            language="cpp"
            theme="vs-dark"
            value={state.code}
            onChange={handleEditorChange}
            loading={<div className="monaco-loading">Loading code editor...</div>}
            options={{ minimap: { enabled: false } }}
          />
        </div>

        <div className="action-bar">
          <button className="btn cast-btn" onClick={handleCast} disabled={state.isCasting}>
            {state.isCasting ? "Casting..." : "CAST"}
          </button>
          {state.passed && (
            <button className="btn" onClick={() => setScreen(currentZoneId === "sandpit" ? "sandpit" : "world-map")}>
              Continue ➜
            </button>
          )}
          <button className="btn" onClick={() => setScreen(currentZoneId === "sandpit" ? "sandpit" : "world-map")}>Back</button>
          <span className="attempt-counter">Attempts: {state.attempts}</span>
        </div>

        <div className="console-panel">
          <div className="console-tabs">
            {(["output", "errors", "raw"] as const).map((tab) => (
              <button
                key={tab}
                className={`tab ${state.outputTab === tab ? "active" : ""}`}
                onClick={() => setState((prev) => ({ ...prev, outputTab: tab }))}
              >
                {tab === "output" ? "Output" : tab === "errors" ? "Errors" : "Raw"}
              </button>
            ))}
          </div>

          <div className="console-content">
            {state.outputTab === "output" && (
              <pre className="console-output">{state.output.length > 0 ? state.output.join("\n") : "Output will appear here..."}</pre>
            )}
            {state.outputTab === "errors" && (
              <div className="console-errors">
                {state.errors.length > 0 ? (
                  state.errors.map((err, idx) => (
                    <div key={idx} className="error-item">
                      <strong>{err.message}</strong>
                      {err.hint && <p className="hint-text">{err.hint}</p>}
                    </div>
                  ))
                ) : (
                  "No errors to display"
                )}
              </div>
            )}
            {state.outputTab === "raw" && (
              <pre className="console-raw">{state.rawOutput || "Raw output will appear here..."}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LessonRunnerScreen;
