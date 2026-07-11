import { describe, it, expect } from 'vitest';
import { substituteVariables } from '../runner/src/index';
import { lintLesson } from '../runner/src/lesson-linter';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Get classes config - path is 2 levels up from tests/
const classesPath = path.join(__dirname, '../content/classes.json');
const classesData = JSON.parse(fs.readFileSync(classesPath, 'utf-8'));
const classes = classesData.classes;

describe('PHASE1.5 teaching/examples fields', () => {
  const fixtureLesson = {
    id: 'test-teaching',
    kind: 'program',
    objective: 'Speak as a {{class_name}}',
    narrative: 'The Forerunner waits.',
    starter_code: '// your cast here',
    solution: 'std::cout << "hello";',
    teaching: 'A {{class_name}} speaks through casts:\n```cpp\nstd::cout << "The gate stands open." << std::endl;\n```',
    examples: [
      { prompt: 'Speak your {{weapon}}\'s name', code: 'std::cout << "{{weapon}}" << std::endl;' },
      { prompt: 'Speak a number', code: 'std::cout << 42 << std::endl;' },
    ],
  };

  describe('substituteVariables', () => {
    it('substitutes template variables inside teaching', () => {
      const lesson = substituteVariables(fixtureLesson as any, classes['warrior']);
      expect(lesson.teaching).toContain('A Warrior speaks through casts');
      expect(lesson.teaching).not.toContain('{{');
    });

    it('substitutes template variables inside examples (prompt and code)', () => {
      const lesson = substituteVariables(fixtureLesson as any, classes['warrior']);
      expect(lesson.examples![0].prompt).toBe("Speak your runeblade's name");
      expect(lesson.examples![0].code).toBe('std::cout << "runeblade" << std::endl;');
      expect(lesson.examples![1].code).toBe('std::cout << 42 << std::endl;');
    });

    it('does not mutate the original lesson examples', () => {
      substituteVariables(fixtureLesson as any, classes['mage']);
      expect(fixtureLesson.examples[0].prompt).toContain('{{weapon}}');
    });

    it('leaves lessons without teaching/examples untouched', () => {
      const bare = { ...fixtureLesson, teaching: undefined, examples: undefined };
      const lesson = substituteVariables(bare as any, classes['archer']);
      expect(lesson.teaching).toBeUndefined();
      expect(lesson.examples).toBeUndefined();
    });
  });

  describe('lintLesson', () => {
    const validLesson = {
      id: 'lint-teaching-fixture',
      kind: 'program',
      zone: 'test_zone',
      act: 1,
      title: 'Lint Fixture',
      concept: 'cout',
      concepts_required: ['cout'],
      teaching: 'Speak thus:\n```cpp\nstd::cout << "words" << std::endl;\n```',
      narrative: 'n',
      objective: 'o',
      starter_code: '// code',
      validation: { checks: [] },
      hints: [],
      rewards: { xp: 0 },
    };

    function lintObject(obj: any): string[] {
      const tmp = path.join(os.tmpdir(), `lint-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
      fs.writeFileSync(tmp, yaml.dump(obj));
      try {
        return lintLesson(tmp);
      } finally {
        fs.unlinkSync(tmp);
      }
    }

    it('accepts a lesson with a teaching block containing a code fence', () => {
      expect(lintObject(validLesson)).toEqual([]);
    });

    it('rejects a lesson with no teaching field', () => {
      const { teaching, ...noTeaching } = validLesson;
      const errors = lintObject(noTeaching);
      expect(errors.some(e => e.includes("teaching") || e.includes('required'))).toBe(true);
    });

    it('rejects a teaching block with no worked-example code fence', () => {
      const errors = lintObject({ ...validLesson, teaching: 'Just vibes, no example.' });
      expect(errors.some(e => e.includes('code block'))).toBe(true);
    });

    it('rejects malformed examples entries', () => {
      const errors = lintObject({ ...validLesson, examples: [{ prompt: 'no code field' }] });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
