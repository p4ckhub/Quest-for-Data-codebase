import { describe, it, expect } from 'vitest';
import { substituteVariables } from '../runner/src/index';
import * as fs from 'fs';
import * as path from 'path';

// Get classes config - path is 2 levels up from tests/
const classesPath = path.join(__dirname, '../content/classes.json');
const classesData = JSON.parse(fs.readFileSync(classesPath, 'utf-8'));
const classes = classesData.classes;

describe('Template Variable Substitution', () => {
  describe('substituteVariables', () => {
    // Test fixture lesson with all three variables
    // Note: starter_spell signature is "int strike()" so solution uses just {{starter_spell}}
    const fixtureLesson = {
      id: 'test-substitution',
      kind: 'program',
      objective: 'Learn {{class_name}} basics',
      prelude: '#include <{{class_name}}>',
      narrative: '{{class_name}} use {{weapon}} to cast {{starter_spell}}',
      epilogue: '',
      starter_code: '// Your code here using {{starter_spell}}',
      solution: 'int main() { return {{starter_spell}}; }'  // signature already has ()
    };

    it('should substitute {{class_name}} for each class', () => {
      const warriorLesson = substituteVariables(fixtureLesson, classes['warrior']);
      expect(warriorLesson.narrative).toContain('Warrior');
      expect(warriorLesson.prelude).toContain('<Warrior>');
      
      const archerLesson = substituteVariables(fixtureLesson, classes['archer']);
      expect(archerLesson.narrative).toContain('Archer');
      expect(archerLesson.prelude).toContain('<Archer>');
      
      const mageLesson = substituteVariables(fixtureLesson, classes['mage']);
      expect(mageLesson.narrative).toContain('Mage');
      expect(mageLesson.prelude).toContain('<Mage>');
    });

    it('should substitute {{weapon}} for each class', () => {
      const warriorLesson = substituteVariables(fixtureLesson, classes['warrior']);
      expect(warriorLesson.narrative).toContain('runeblade');
      
      const archerLesson = substituteVariables(fixtureLesson, classes['archer']);
      expect(archerLesson.narrative).toContain('sigilbow');
      
      const mageLesson = substituteVariables(fixtureLesson, classes['mage']);
      expect(mageLesson.narrative).toContain('focus-staff');
    });

    it('should substitute {{starter_spell}} for each class', () => {
      // starter_spell contains the full signature (e.g. "int strike()")
      const warriorLesson = substituteVariables(fixtureLesson, classes['warrior']);
      expect(warriorLesson.starter_code).toContain('int strike()');
      expect(warriorLesson.solution).toContain('return int strike();');
      
      const archerLesson = substituteVariables(fixtureLesson, classes['archer']);
      expect(archerLesson.starter_code).toContain('int loose_arrow()');
      expect(archerLesson.solution).toContain('return int loose_arrow();');
      
      const mageLesson = substituteVariables(fixtureLesson, classes['mage']);
      expect(mageLesson.starter_code).toContain('int force_bolt()');
      expect(mageLesson.solution).toContain('return int force_bolt();');
    });

    it('should handle multiple variables in same string', () => {
      const multiLineLesson = {
        ...fixtureLesson,
        narrative: '{{class_name}} weapon: {{weapon}}, spell: {{starter_spell}}',
        objective: 'Use {{starter_spell}} as a {{class_name}}'
      };
      
      const lesson = substituteVariables(multiLineLesson, classes['warrior']);
      // starter_spell contains full signature "int strike()"
      expect(lesson.narrative).toBe('Warrior weapon: runeblade, spell: int strike()');
      expect(lesson.objective).toBe('Use int strike() as a Warrior');
    });

    it('should leave non-variable text unchanged', () => {
      const plainLesson = {
        ...fixtureLesson,
        narrative: 'This has no variables',
        objective: 'Just plain text'
      };
      
      const lesson = substituteVariables(plainLesson, classes['warrior']);
      expect(lesson.narrative).toBe('This has no variables');
      expect(lesson.objective).toBe('Just plain text');
    });
    
    it('should substitute hint messages', () => {
      const lessonWithHints = {
        ...fixtureLesson,
        hints: [
          { trigger: 'error1', message: '{{class_name}} should use {{weapon}}' }
        ]
      };
      
      const warriorLesson = substituteVariables(lessonWithHints, classes['warrior']);
      expect(warriorLesson.hints[0].message).toBe('Warrior should use runeblade');
    });
  });

  describe('integration - lesson with all fields', () => {
    const fullLesson = {
      id: 'full-test',
      kind: 'program',
      title: 'Test Lesson',
      concept: 'basics',
      concepts_required: ['main'],
      objective: 'Learn {{class_name}}',
      narrative: '{{class_name}} start with {{starter_spell}} using {{weapon}}',
      prelude: '#include "{{class_name}}.h"',
      epilogue: '// done as {{class_name}}',
      starter_code: '// call {{starter_spell}}',
      solution: 'int main() { return {{starter_spell}}; }',  // signature already has ()
      validation: { checks: [] },
      hints: [{ trigger: 'hint1', message: '{{class_name}} hint with {{weapon}}' }],
      rewards: { xp: 10 }
    };

    it('should substitute for Warrior', () => {
      const lesson = substituteVariables(fullLesson, classes['warrior']);
      expect(lesson.narrative).toBe('Warrior start with int strike() using runeblade');
      expect(lesson.prelude).toBe('#include "Warrior.h"');
      expect(lesson.epilogue).toBe('// done as Warrior');
      expect(lesson.starter_code).toBe('// call int strike()');
      expect(lesson.solution).toBe('int main() { return int strike(); }');
      expect(lesson.objective).toBe('Learn Warrior');
      expect(lesson.hints[0].message).toBe('Warrior hint with runeblade');
    });

    it('should substitute for Archer', () => {
      const lesson = substituteVariables(fullLesson, classes['archer']);
      expect(lesson.narrative).toBe('Archer start with int loose_arrow() using sigilbow');
      expect(lesson.prelude).toBe('#include "Archer.h"');
      expect(lesson.epilogue).toBe('// done as Archer');
      expect(lesson.starter_code).toBe('// call int loose_arrow()');
      expect(lesson.solution).toBe('int main() { return int loose_arrow(); }');
      expect(lesson.objective).toBe('Learn Archer');
      expect(lesson.hints[0].message).toBe('Archer hint with sigilbow');
    });

    it('should substitute for Mage', () => {
      const lesson = substituteVariables(fullLesson, classes['mage']);
      expect(lesson.narrative).toBe('Mage start with int force_bolt() using focus-staff');
      expect(lesson.prelude).toBe('#include "Mage.h"');
      expect(lesson.epilogue).toBe('// done as Mage');
      expect(lesson.starter_code).toBe('// call int force_bolt()');
      expect(lesson.solution).toBe('int main() { return int force_bolt(); }');
      expect(lesson.objective).toBe('Learn Mage');
      expect(lesson.hints[0].message).toBe('Mage hint with focus-staff');
    });
  });
});
