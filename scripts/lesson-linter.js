const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const yaml = require('js-yaml');

const ajv = new Ajv();
const schemaPath = path.join(__dirname, '../schemas/lesson.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
const validate = ajv.compile(schema);

function lintLesson(lessonPath) {
  const content = fs.readFileSync(lessonPath, 'utf-8');
  const data = yaml.load(content);

  const errors = [];

  if (!validate(data)) {
    errors.push(...(validate.errors || []).map(e => `Schema: ${e.schemaPath} ${e.message}`));
  }

  return errors;
}

module.exports = { lintLesson };
