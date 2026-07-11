/**
 * Friendly Error Translator (FET)
 * Translates g++ compile errors into user-friendly messages
 */

export interface ErrorTranslation {
  originalError: string;
  friendlyMessage: string;
  hint?: string;
}

// Common error patterns and their translations
const ERROR_PATTERNS: Array<{
  regex: RegExp;
  message: string;
  hint?: string;
}> = [
  {
    regex: /error: unknown type name '([^']+)'/,
    message: "Unknown type name - make sure you're using standard C++ types (int, bool, char, etc.)",
    hint: "Did you include the correct headers or use proper type names?",
  },
  {
    regex: /error: use of undeclared identifier '([^']+)'/,
    message: "Undeclared identifier - you need to define your variables before using them",
    hint: "Define the variable before using it, or check for typos in the name",
  },
  {
    regex: /error: expected ';' after [^;]+/,
    message: "Missing semicolon - each statement must end with ';'",
    hint: "Check the end of the line and add a semicolon if missing",
  },
  {
    regex: /error: no member named '([^']+)'/,
    message: "Invalid member access - check your class and namespace usage",
    hint: "Make sure you're accessing members that exist on the type",
  },
  {
    regex: /error: redefinition of '([^']+)'/,
    message: "Duplicate definition - you've defined this identifier more than once",
    hint: "Check for duplicate function or variable definitions",
  },
  {
    regex: /error: call to non-static member function without an object argument/,
    message: "Non-static method called without an object instance",
    hint: "Create an instance of the class or make the method static",
  },
  {
    regex: /error: implicit declaration of function '([^']+)'/,
    message: "Function declared but not defined",
    hint: "Define the function implementation or add a forward declaration",
  },
];

/**
 * Translate a g++ error into a friendly message
 */
export function translateError(errorText: string): ErrorTranslation[] {
  const translations: ErrorTranslation[] = [];
  
  const lines = errorText.split("\n");
  
  for (const line of lines) {
    if (!line.trim().startsWith("error:")) continue;
    
    let foundMatch = false;
    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        translations.push({
          originalError: line.trim(),
          friendlyMessage: pattern.message,
          hint: pattern.hint,
        });
        foundMatch = true;
        break;
      }
    }
    
    // If no pattern matched, use a generic translation
    if (!foundMatch) {
      translations.push({
        originalError: line.trim(),
        friendlyMessage: "Compilation error - check your code for syntax issues",
        hint: "Review the error location and fix any syntax problems",
      });
    }
  }
  
  return translations;
}

/**
 * Get the first translated error (most common use case)
 */
export function classifyFirstError(errorText: string): ErrorTranslation {
  const translations = translateError(errorText);
  return translations.length > 0 ? translations[0] : {
    originalError: errorText,
    friendlyMessage: "Unknown compilation error",
    hint: "Review the raw error output for details",
  };
}
