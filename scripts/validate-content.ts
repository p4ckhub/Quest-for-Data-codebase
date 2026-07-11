import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';

function loadJson(filePath: string): unknown {
  const absolutePath = path.resolve(__dirname, '..', filePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(content);
}

function loadSchema(filePath: string) {
  const absolutePath = path.resolve(__dirname, '..', filePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(content);
}

function validate(data: unknown, schema: unknown): { valid: boolean; errors: Array<{instancePath: string; schemaPath: string; message: string}> } {
  const ajv = new Ajv({ allErrors: true });
  const compile = ajv.compile(schema as any);
  const valid = compile(data as any);
  if (!valid && compile.errors) {
    return {
      valid: false,
      errors: compile.errors.map((e: any) => ({
        instancePath: e.instancePath || '/',
        schemaPath: e.schemaPath || '#',
        message: e.message || 'Unknown validation error',
      })),
    };
  }
  return { valid: true, errors: [] };
}

function main(): number {
  const errors: Array<{file: string; errors: Array<{instancePath: string; schemaPath: string; message: string}>}> = [];

  // Validate classes.json
  const classesData = loadJson('content/classes.json');
  const classesSchema = loadSchema('schemas/classes.schema.json');
  const classesResult = validate(classesData, classesSchema);
  if (!classesResult.valid) {
    errors.push({ file: 'content/classes.json', errors: classesResult.errors });
  }

  // Validate sprites.json
  const spritesData = loadJson('content/sprites.json');
  const spritesSchema = loadSchema('schemas/sprites.schema.json');
  const spritesResult = validate(spritesData, spritesSchema);
  if (!spritesResult.valid) {
    errors.push({ file: 'content/sprites.json', errors: spritesResult.errors });
  }

  // Report results
  if (errors.length === 0) {
    console.log('Validation passed: content/classes.json, content/sprites.json');
    return 0;
  }

  console.error('Validation failed:');
  for (const err of errors) {
    console.error(`  ${err.file}`);
    for (const e of err.errors) {
      console.error(`    ${e.instancePath}: ${e.message} (${e.schemaPath})`);
    }
  }
  return 1;
}

process.exitCode = main();
