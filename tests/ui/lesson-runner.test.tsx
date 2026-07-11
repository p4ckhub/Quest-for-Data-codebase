import { describe, it, expect } from "vitest";
import { translateError, classifyFirstError } from "../../ui/src/lib/fet";

describe("Friendly Error Translator", () => {
  it("should translate unknown type name error", () => {
    const errorText = "error: unknown type name 'string'";
    const result = translateError(errorText);
    
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].friendlyMessage).toContain("Unknown type name");
  });

  it("should translate undeclared identifier error", () => {
    const errorText = "error: use of undeclared identifier 'x'";
    const result = translateError(errorText);
    
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].friendlyMessage).toContain("Undeclared identifier");
  });

  it("should translate missing semicolon error", () => {
    const errorText = "error: expected ';' after statement";
    const result = translateError(errorText);
    
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].friendlyMessage).toContain("Missing semicolon");
  });

  it("should provide hint for common errors", () => {
    const errorText = "error: expected ';' after statement";
    const result = classifyFirstError(errorText);
    
    expect(result.hint).toBeDefined();
    expect(result.hint?.length).toBeGreaterThan(0);
  });

  it("should handle unknown errors gracefully", () => {
    const errorText = "error: some unknown error message";
    const result = classifyFirstError(errorText);
    
    expect(result.friendlyMessage).toBeDefined();
    expect(result.originalError).toBe(errorText);
  });

  it("should classify first error for multi-line errors", () => {
    const errorText = "error: unknown type name 'string'\nerror: expected ';' after statement";
    const result = classifyFirstError(errorText);
    
    expect(result.friendlyMessage).toBeDefined();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import LessonRunnerScreen, { renderTeachingParts } from "../../ui/src/components/LessonRunner";
import { useGameStore } from "../../ui/src/store";

describe("renderTeachingParts", () => {
  it("splits prose and fenced code blocks", () => {
    const parts = renderTeachingParts('Speak thus:\n```cpp\nstd::cout << "hi";\n```\nAnd so it is.');
    expect(parts).toEqual([
      { kind: "prose", content: "Speak thus:" },
      { kind: "code", content: 'std::cout << "hi";' },
      { kind: "prose", content: "And so it is." },
    ]);
  });

  it("handles teaching with no code fence as pure prose", () => {
    expect(renderTeachingParts("just words")).toEqual([{ kind: "prose", content: "just words" }]);
  });
});

describe("LessonRunnerScreen", () => {
  beforeEach(() => {
    // The screen is store-driven: its load effect bails without a current
    // lesson id in the store (LessonRunner.tsx useEffect guard).
    useGameStore.setState({ currentZoneId: "test-zone", currentLessonId: "test-lesson" });
    Object.defineProperty(window, "gameapi", {
      value: {
        lessons: {
          load: vi.fn((lessonId) => Promise.resolve({
            success: true,
            lesson: {
              id: lessonId,
              teaching: 'The way of the cast:\n```cpp\nstd::cout << "The gate stands open." << std::endl;\n```',
              examples: [{ prompt: "Speak a number", code: "std::cout << 42 << std::endl;" }],
              narrative: "Test narrative",
              objective: "Test objective",
              starter_code: "// Test code",
              hints: [{ trigger: "attempt:3", message: "Need help?" }],
            },
          })),
          cast: vi.fn((params) => Promise.resolve({
            success: true,
            output: "[LOG] Welcome to the Forge!",
          })),
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    if (vi.clearAllMocks) {
      vi.clearAllMocks();
    }
  });

  it("should handle cast with translation errors", async () => {
    (window.gameapi?.lessons?.cast as any).mockResolvedValueOnce({
      success: false,
      compileError: "error: unknown type name 'string'",
    });

    render(<LessonRunnerScreen />);

    await waitFor(() => {
      expect(window.gameapi?.lessons?.load).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it("renders the teaching panel with worked example and practice variations", async () => {
    render(<LessonRunnerScreen />);

    await waitFor(() => {
      expect(screen.getByText(/The way of the cast/)).toBeTruthy();
    }, { timeout: 2000 });
    expect(screen.getByText(/The gate stands open/)).toBeTruthy();
    expect(screen.getByText(/Speak a number/)).toBeTruthy();
    expect(screen.getByText(/std::cout << 42/)).toBeTruthy();
  });

  it("renders attempt-triggered hints inline in the objective bar as (HINT: ...)", async () => {
    (window.gameapi?.lessons?.cast as any).mockResolvedValue({
      success: true,
      passed: false,
      checks: [],
      output: "",
    });

    render(<LessonRunnerScreen />);
    await waitFor(() => {
      expect(window.gameapi?.lessons?.load).toHaveBeenCalled();
    }, { timeout: 2000 });

    // No hint before the attempt threshold
    expect(screen.queryByText(/HINT:/)).toBeNull();

    const { fireEvent } = await import("@testing-library/react");
    const castButton = screen.getByText("CAST");
    for (let i = 0; i < 3; i++) {
      fireEvent.click(castButton);
      await waitFor(() => expect(castButton.textContent).toBe("CAST"), { timeout: 2000 });
    }

    const objective = screen.getByText(/Test objective/);
    expect(objective.textContent).toContain("(HINT: Need help?)");
  });
});
