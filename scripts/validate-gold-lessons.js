const fs = require('fs');
const path = require('path');

// Import lesson-linter
const { lintLesson } = require('./lesson-linter.js');

// Import runner
const { runLesson } = require('./lesson-runner.js');

// Validate a single lesson file
function validateLessonFile(filePath) {
  const errors = lintLesson(filePath);
  return { valid: errors.length === 0, errors };
}

// Run a lesson with the reference solution code
async function runLessonWithSolution(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const yaml = require('js-yaml').load;
  const lessonData = yaml(content);

  const lesson = {
    id: lessonData.id,
    objective: lessonData.objective,
    starter_code: lessonData.starter_code,
    prelude: lessonData.prelude || '',
    epilogue: lessonData.epilogue || '',
    validation: lessonData.validation,
    hints: lessonData.hints || []
  };

  // The solution field contains the reference code
  return runLesson(lesson, lessonData.solution);
}

async function validateGoldLessons() {
  const baseDir = path.join(__dirname, '..');
  const lesson1Path = path.join(baseDir, 'content/zones/act1/character_creation/zone-0-lesson-1.yaml');
  const lesson2Path = path.join(baseDir, 'content/zones/act1/function_forge/zone-2-lesson-1.yaml');

  let exitCode = 0;
  let lessonsValidated = 0;

  // Validate lesson 1 (variables-101)
  console.log('=== Validating variables-101 ===');
  const v1 = validateLessonFile(lesson1Path);
  if (!v1.valid) {
    console.error('✗ Lesson 1 schema validation failed:');
    v1.errors.forEach(e => console.error(`  - ${e}`));
    exitCode = 1;
  } else {
    console.log('✓ Lesson 1 schema validation passed');
    lessonsValidated++;
  }

  // Validate lesson 2 (forge-strike-warrior)
  console.log('=== Validating forge-strike-warrior ===');
  const v2 = validateLessonFile(lesson2Path);
  if (!v2.valid) {
    console.error('✗ Lesson 2 schema validation failed:');
    v2.errors.forEach(e => console.error(`  - ${e}`));
    exitCode = 1;
  } else {
    console.log('✓ Lesson 2 schema validation passed');
    lessonsValidated++;
  }

  // Run lesson 1 with reference solution
  if (exitCode === 0) {
    console.log('=== Testing variables-101 solution ===');
    try {
      const r1 = await runLessonWithSolution(lesson1Path);
      if (r1.success) {
        console.log('✓ Lesson 1 solution ran successfully');
        lessonsValidated++;
      } else {
        console.error('✗ Lesson 1 solution failed:');
        console.error(r1.output);
        exitCode = 1;
      }
    } catch (e) {
      console.error('✗ Lesson 1 solution error:', e.message);
      exitCode = 1;
    }
  }

  // Run lesson 2 with reference solution
  if (exitCode === 0) {
    console.log('=== Testing forge-strike-warrior solution ===');
    try {
      const r2 = await runLessonWithSolution(lesson2Path);
      if (r2.success) {
        console.log('✓ Lesson 2 solution ran successfully');
        lessonsValidated++;
      } else {
        console.error('✗ Lesson 2 solution failed:');
        console.error(r2.output);
        exitCode = 1;
      }
    } catch (e) {
      console.error('✗ Lesson 2 solution error:', e.message);
      exitCode = 1;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Lessons validated: ${lessonsValidated}/4 checks`);
  
  if (exitCode !== 0) {
    console.error('Validation FAILED');
  } else {
    console.log('All validations PASSED');
  }

  return exitCode;
}

// Run the validation
validateGoldLessons().then(exitCode => {
  process.exit(exitCode);
}).catch(e => {
  console.error('Fatal error:', e.message || e);
  process.exit(1);
});
