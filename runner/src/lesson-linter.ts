import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import * as yaml from 'js-yaml';

const ajv = new Ajv();
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../../schemas/lesson.schema.json'), 'utf-8'));
const validate = ajv.compile(schema);

export function lintLesson(lessonPath: string): string[] {
  const content = fs.readFileSync(lessonPath, 'utf-8');
  const data = yaml.load(content);

  const errors: string[] = [];

  if (!validate(data)) {
    errors.push(...(validate.errors || []).map(e => `Schema: ${e.schemaPath} ${e.message}`));
  }

  return errors;
}
