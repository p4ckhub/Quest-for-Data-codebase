import { execSync } from 'child_process';
import { join } from 'path';
import { classifyFirstError, errorTable } from '../runner/src/error_table';

const FIXTURES_DIR = join(__dirname, 'fixtures/errors');

// Get first error line from stderr (skip warning lines and note: lines)
function getFirstErrorLine(stderr: string): string {
  const lines = stderr.split('\n');
  for (const line of lines) {
    // Look for "error:" that's not a note or warning continuation
    if (line.includes('error:') && !line.trim().startsWith('note:') && !line.includes('warning:')) {
      return line.trim();
    }
  }
  return '';
}

// Extract line number from error message like file:line:col: error:
function extractLine(stderr: string): string {
  const firstError = getFirstErrorLine(stderr);
  const match = firstError.match(/^(.*?):(\d+):(\d+):/);
  return match ? match[2] : '0';
}

// Compile a fixture and return (error info or null if no error)
function compileFixture(filename: string) {
  const fixturePath = join(FIXTURES_DIR, filename);
  try {
    execSync(`g++ -std=c++17 -O0 -g0 -Wall ${fixturePath}`, { stdio: 'pipe' });
    return null; // No compilation error
  } catch (e: any) {
    const stderr = e.stderr ? String(e.stderr) : '';
    const firstError = getFirstErrorLine(stderr);
    const line = extractLine(stderr);
    return { stderr, firstError, line };
  }
}

describe('Error Table Classification', () => {
  
  test('classify missing_semicolon error', () => {
    const fixture = compileFixture('missing_semicolon.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('missing_semicolon');
    expect(result.line).toBe('4'); // Line 4 has the error (g++ reports line with missing semicolon)
  });
  
  test('classify undeclared_identifier error', () => {
    const fixture = compileFixture('undeclared_identifier.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('undeclared_identifier');
    expect(result.line).toBe('4'); // Line 4 has the error (g++ reports line with ZZZZ reference)
  });
  
  test('classify unknown_type error', () => {
    const fixture = compileFixture('unknown_type.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('unknown_type');
    expect(result.line).toBe('3'); // Line 3 has the error (g++ reports line with TypeX)
  });
  
  test('classify invalid_init_conversion error', () => {
    const fixture = compileFixture('invalid_init_conversion.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('invalid_init_conversion');
    expect(result.line).toBe('3'); // Line 3 has the error
  });
  
  test('classify missing_return error', () => {
    const fixture = compileFixture('missing_return.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('missing_return');
    expect(result.line).toBe('3'); // Line 3 has the error
  });
  
  test('classify expected_brace error', () => {
    const fixture = compileFixture('expected_brace.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('expected_brace');
    expect(result.line).toBe('4'); // Line 4 has the error
  });
  
  test('classify redefinition error', () => {
    const fixture = compileFixture('redefinition.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('redefinition');
    expect(result.line).toBe('4'); // Line 4 has the error
  });
  
  test('classify no_matching_function error', () => {
    const fixture = compileFixture('no_matching_function.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('no_matching_function');
    expect(result.line).toBe('5'); // Line 5 has the error
  });
  
  test('classify invalid_operands error', () => {
    const fixture = compileFixture('invalid_operands.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('invalid_operands');
    expect(result.line).toBe('5'); // Line 5 has the error
  });
  
  test('classify assign_to_const error', () => {
    const fixture = compileFixture('assign_to_const.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('assign_to_const');
    expect(result.line).toBe('4'); // Line 4 has the error
  });
  
  test('classify const_pointer error', () => {
    const fixture = compileFixture('const_pointer.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('const_pointer');
    expect(result.line).toBe('1'); // Line 1 has the error
  });
  
  test('classify missing_main error', () => {
    const fixture = compileFixture('missing_main.cpp');
    expect(fixture).not.toBeNull();
    
    const result = classifyFirstError(fixture!.stderr);
    expect(result.id).toBe('missing_main');
    // Linker error doesn't have line number, should be '0'
    expect(result.line).toBe('0');
  });
  
  test('fallthrough to unknown_error on garbage stderr', () => {
    const result = classifyFirstError('garbage random text');
    expect(result.id).toBe('unknown_error');
  });
  
  test('error table has expected number of entries', () => {
    // Per dashboard decision: merge undeclared_identifier and unknown_type
    // G++ provides 11 unique error patterns (not 12+)
    expect(errorTable.length).toBeGreaterThanOrEqual(11);
  });
});
