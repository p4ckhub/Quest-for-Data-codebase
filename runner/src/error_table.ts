// Error classification for g++ compiler diagnostics
// Based on spec §12 and real g++ stderr analysis
//
// NOTE: g++ produces identical error messages for all "not declared in this scope" cases,
// whether it's a variable, type, or function. The only distinguishing feature is the identifier
// pattern (lowercase vs uppercase first char). We categorize based on that:
// - undeclared_identifier: lowercase identifiers (variables, functions)
// - unknown_type: uppercase identifiers (types/classes)
// Both use the same core error text but are distinguished by the identifier pattern.

export interface ErrorInfo {
  id: string;
  regex: RegExp;
  friendlyTemplate: string;
}

/**
 * Error table for g++ diagnostics.
 * Each entry has an id, regex to match the error message, and a friendly template.
 * Entries are ordered - first match wins.
 */
export const errorTable: ErrorInfo[] = [
  // 1. missing_semicolon - expected ',' or ';' before token
  {
    id: 'missing_semicolon',
    regex: /expected .*? before/i,
    friendlyTemplate: "Your incantation trails off unfinished — a ';' is missing near line {line}."
  },

  // 2. invalid_init_conversion - invalid conversion from X to Y
  {
    id: 'invalid_init_conversion',
    regex: /invalid conversion from ['\u2018\u2019][^\u2018\u2019]+['\u2018\u2019] to ['\u2018\u2019][^\u2018\u2019]+['\u2018\u2019]/i,
    friendlyTemplate: "You're pouring the wrong essence into that vessel — the types don't match."
  },

  // 3. missing_return - return-statement with a value, in function returning void
  {
    id: 'missing_return',
    regex: /return-statement with a value.*function returning ['\u2018\u2019]void['\u2018\u2019]/i,
    friendlyTemplate: "The spell promises to return a value — but ends without returning anything."
  },

  // 4. expected_brace - expected '}' at end of input
  {
    id: 'expected_brace',
    regex: /expected ['\u2018\u2019]\}['\u2018\u2019] at end of input/i,
    friendlyTemplate: "A binding rune '{{' was opened but never closed with '}}'."
  },

  // 5. redeclaration - redeclaration of identifier (g++ says "redefinition of"
  // for duplicate function/class bodies, "redeclaration of" for locals)
  {
    id: 'redefinition',
    regex: /re(?:declaration|definition) of ['\u2018\u2019][^\u2018\u2019]+['\u2018\u2019]/i,
    friendlyTemplate: "'{1}' has already been given form — you cannot awaken it twice in one scope."
  },

  // 6. no_matching_function - no matching function for call (overload mismatch)
  {
    id: 'no_matching_function',
    regex: /no matching function for call to ['\u2018\u2019][a-zA-Z_][a-zA-Z0-9_]*/i,
    friendlyTemplate: "No forged spell matches that invocation of '{1}' — check its parameters."
  },

  // 7. unknown_type - g++: 'Type' was not declared (type names start with uppercase)
  // We identify types by uppercase first letter in the error message
  {
    id: 'unknown_type',
    regex: /['\u2018\u2019][A-Z][a-zA-Z]*['\u2018\u2019] was not declared in this scope/,
    friendlyTemplate: "'{1}' is not a form the Compiler recognizes. Check the spelling of the type."
  },

  // 8. undeclared_identifier - g++: 'identifier' was not declared in this scope
  // Covers variables and functions with lowercase first letter
  {
    id: 'undeclared_identifier',
    regex: /['\u2018\u2019][a-z_][a-zA-Z0-9_]*['\u2018\u2019] was not declared in this scope/i,
    friendlyTemplate: "The world doesn't know the name '{1}' yet — declare it before using it."
  },

  // 9. invalid_operands - invalid operands to binary expression
  {
    id: 'invalid_operands',
    regex: /invalid operands of types ['\u2018\u2019][^\u2018\u2019]+['\u2018\u2019] and ['\u2018\u2019][^\u2018\u2019]+['\u2018\u2019] to binary/i,
    friendlyTemplate: "Those two essences cannot be combined with that operator."
  },

  // 10. assign_to_const - assignment of read-only variable
  {
    id: 'assign_to_const',
    regex: /assignment of read-only variable ['\u2018\u2019][^\u2018\u2019]+['\u2018\u2019]/i,
    friendlyTemplate: "'{1}' was sealed with const — its value is fixed forever."
  },

  // 10b. const_pointer - 'p' does not name a type (const pointer declaration issue)
  {
    id: 'const_pointer',
    regex: /['\u2018\u2019][a-zA-Z_][a-zA-Z0-9_]*['\u2018\u2019] does not name a type/i,
    friendlyTemplate: "The declaration of '{1}' is malformed — check the const placement and syntax."
  },

  // 11. missing_main - undefined reference to 'main' (linker error)
  {
    id: 'missing_main',
    regex: /undefined reference to [`']main['`]/i,
    friendlyTemplate: "Every incantation needs a heart — a main() where casting begins."
  },

  // 12. unknown_error - fallthrough (handled in classifyFirstError function, not table)
];

/**
 * Extract line number from g++ error message.
 * Format: file:line:col: error: ...
 */
function extractLine(stderr: string): string {
  const lines = stderr.split('\n');
  for (const line of lines) {
    // Match file:line:col: pattern
    const match = line.match(/^(.*?):(\d+):(\d+):/);
    if (match) {
      return match[2];
    }
  }
  return '0';
}

/**
 * Find error matches in stderr and return the first one.
 */
function findErrorMatch(stderr: string): { id: string; captures: string[]; line: string } | null {
  for (const entry of errorTable) {
    if (entry.regex.test(stderr)) {
      // Get line number
      const line = extractLine(stderr);

      // Extract captures (first capture group, or empty array if none)
      const match = stderr.match(entry.regex);
      const captures = match && match.length > 1 ? match.slice(1) : [];

      return { id: entry.id, captures, line };
    }
  }
  return null;
}

/**
 * Classify the first error from g++ stderr output.
 * Returns the error id, captures, and line number.
 */
export function classifyFirstError(stderr: string): { id: string; captures: string[]; line: string } {
  const result = findErrorMatch(stderr);

  if (result) {
    return result;
  }

  // Fallthrough to unknown_error
  return { id: 'unknown_error', captures: [], line: '0' };
}