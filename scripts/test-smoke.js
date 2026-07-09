import { spawnSync } from 'child_process';

const sandboxRun = '/home/serenity/.hermes/coding/quest-for-data/Quest-for-Data-codebase/toolchain/bin/sandbox_run';
const runCmd = `${sandboxRun} --wall-ms 5000 --mem-mb 256 /tmp/test_gameapi`;

console.log('Running:', runCmd);
const result = spawnSync(runCmd, { shell: true, encoding: 'utf8' });

let output = (result.stdout || '') + (result.stderr || '');
console.log('Output length:', output.length);
console.log('Output repr:', JSON.stringify(output.substring(0, 150)));

// Check for specific markers
if (output.includes('@@EV@@ ')) console.log('Found @@EV@@');
if (output.includes('@@RESULT@@ ')) console.log('Found @@RESULT@@');

const lines = output.split('\n');
console.log('Number of lines:', lines.length);
lines.forEach((line, i) => {
    if (line.startsWith('@')) console.log(`Line ${i}:`, JSON.stringify(line));
});
