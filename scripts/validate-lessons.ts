const fs = require('fs');
const path = require('path');

const { lintLesson } = require('../runner/src/lesson-linter.ts');
const { runLesson, substituteVariables } = require('../runner/src/index.ts');
const yaml = require('js-yaml');

// Get classes config
const classesPath = path.join(__dirname, '../content/classes.json');
const classesData = JSON.parse(fs.readFileSync(classesPath, 'utf-8'));
const classes = classesData.classes;

// All lessons to validate: every Zone 0-2 lesson file on disk plus every
// sandpit manifest entry — new lessons are picked up with no script change.
const zoneDirs = [
  'content/zones/act1/character_creation',
  'content/zones/act1/vault_of_variables',
  'content/zones/act1/function_forge',
];
const lessonsToValidate = [];
for (const dir of zoneDirs) {
  const files = fs.readdirSync(path.join(__dirname, '..', dir))
    .filter(f => f.endsWith('.yaml') && !f.startsWith('encounter-'))
    .sort();
  for (const f of files) lessonsToValidate.push({ path: `${dir}/${f}`, class: 'warrior' });
}
const sandpitManifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../content/sandpit/sandpit.json'), 'utf-8'));
for (const entry of sandpitManifest.lessons) {
  lessonsToValidate.push({ path: `content/sandpit/${entry.file}`, class: 'warrior' });
}

// Test substitution with different classes for forge-strike-warrior
const substitutionTestClasses = ['warrior', 'archer', 'mage'];

// Validate a single lesson file
function validateLessonFile(filePath) {
  const errors = lintLesson(filePath);
  return { valid: errors.length === 0, errors };
}

// Run a lesson with the reference solution code (after applying substitutions)
async function runLessonWithSolutionAndSubstitution(filePath, classKey) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lessonData = yaml.load(content);

  const classData = classes[classKey];
  
  // Apply template variable substitution
  const substitutedLesson = substituteVariables({
    id: lessonData.id,
    kind: lessonData.kind || 'program',
    objective: lessonData.objective,
    starter_code: lessonData.starter_code,
    prelude: lessonData.prelude || '',
    epilogue: lessonData.epilogue || '',
    harness: lessonData.harness,
    stdin_fixture: lessonData.stdin_fixture,
    extra_units: lessonData.extra_units,
    teaching: lessonData.teaching,
    examples: lessonData.examples,
    narrative: lessonData.narrative,
    solution: lessonData.solution,
    validation: lessonData.validation,
    hints: lessonData.hints || []
  }, classData);

  // The solution field contains the reference code
  return runLesson(substitutedLesson, substitutedLesson.solution);
}

async function validateAllLessons() {
  const baseDir = path.join(__dirname, '..');
  
  let exitCode = 0;
  let lessonsValidated = 0;
  let totalChecks = 0;

  console.log('=== Validating All Lessons ===\n');

  // Validate each lesson
  for (const lesson of lessonsToValidate) {
    const fullPath = path.join(baseDir, lesson.path);
    const classKey = lesson.class;
    const lessonName = path.basename(lesson.path, '.yaml');
    
    console.log(`=== Validating ${lessonName} (${classKey}) ===`);
    
    // Schema validation
    const v = validateLessonFile(fullPath);
    if (!v.valid) {
      console.error(`✗ Schema validation failed for ${lessonName}:`);
      v.errors.forEach(e => console.error(`  - ${e}`));
      exitCode = 1;
    } else {
      console.log('✓ Schema validation passed');
      lessonsValidated++;
      totalChecks++;
    }
    
    // Solution execution — runs whenever THIS lesson linted clean, so one bad
    // lesson doesn't hide runtime failures in every lesson after it
    if (v.valid) {
      try {
        const r = await runLessonWithSolutionAndSubstitution(fullPath, classKey);
        // The reference solution must not only run: it must PASS the lesson's
        // own validation checks (r.passed). A lesson whose solution can't pass
        // its checks is shipping broken.
        if (r.success && r.passed !== false) {
          console.log(`✓ ${lessonName} solution ran and passed validation`);
          lessonsValidated++;
          totalChecks++;
        } else {
          console.error(`✗ ${lessonName} solution failed:`);
          console.error('  compileError:', r.compileError || 'none');
          console.error('  error:', r.error || 'none');
          console.error('  output:', r.output || 'none');
          if (r.checks) {
            for (const c of r.checks.filter((c) => !c.passed)) {
              console.error(`  failed check [${c.type}${c.id ? ':' + c.id : ''}]: ${c.message}`);
            }
          }
          exitCode = 1;
        }
      } catch (e) {
        console.error(`✗ ${lessonName} solution error:`, e.message);
        exitCode = 1;
      }
    }
    
    console.log();
  }

  // Test substitution with different classes for forge-strike-warrior — its
  // narrative and hints carry template vars
  console.log('=== Testing Substitution (forge-strike-warrior) ===');
  const zone2Lesson1Path = path.join(baseDir, 'content/zones/act1/function_forge/forge-strike-warrior.yaml');
  
  for (const classKey of substitutionTestClasses) {
    console.log(`\n--- Testing with ${classKey} ---`);
    try {
      const content = fs.readFileSync(zone2Lesson1Path, 'utf-8');
      const lessonData = yaml.load(content);
      const classData = classes[classKey];
      
      const substitutedLesson = substituteVariables({
        id: lessonData.id,
        kind: lessonData.kind || 'program',
        objective: lessonData.objective,
        starter_code: lessonData.starter_code,
        prelude: lessonData.prelude || '',
        epilogue: lessonData.epilogue || '',
        harness: lessonData.harness,
        narrative: lessonData.narrative,
        solution: lessonData.solution,
        validation: lessonData.validation,
        hints: lessonData.hints || []
      }, classData);
      
      // Check that substitution occurred
      if (substitutedLesson.narrative && !substitutedLesson.narrative.includes('{{')) {
        console.log(`✓ Narrative substituted (no template vars remain)`);
        lessonsValidated++;
        totalChecks++;
      } else {
        console.error('✗ Narrative not substituted');
        exitCode = 1;
      }
      
      if (substitutedLesson.hints && Array.isArray(substitutedLesson.hints)) {
        const hasSubstitution = substitutedLesson.hints.some(h => h.message.includes(classData.display_name) || h.message.includes(classData.weapon));
        if (hasSubstitution) {
          console.log(`✓ Hint messages substituted`);
          lessonsValidated++;
          totalChecks++;
        } else {
          console.error('✗ Hint messages not substituted');
          exitCode = 1;
        }
      }
      
    } catch (e) {
      console.error(`✗ Substitution test with ${classKey} error:`, e.message);
      exitCode = 1;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Lessons validated: ${lessonsValidated}/${totalChecks} checks`);

  if (exitCode !== 0) {
    console.error('Validation FAILED');
  } else {
    console.log('All validations PASSED');
  }

  return exitCode;
}

// Run the validation
validateAllLessons().then(exitCode => {
  process.exit(exitCode);
}).catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
