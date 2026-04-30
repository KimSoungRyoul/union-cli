export class UnifiedError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'UnifiedError'
    this.code = code
    this.details = details
  }
}

export function formatError(error: UnifiedError, debug: boolean): string {
  if (debug) {
    const parts = [`Error [${error.code}]: ${error.message}`]
    if (error.details) {
      parts.push(`Details: ${JSON.stringify(error.details, null, 2)}`)
    }
    if (error.stack) {
      parts.push(error.stack)
    }
    return parts.join('\n')
  }

  // User-friendly format
  const suggestion = errorSuggestion(error.code)
  let result = `Error: ${error.message}`
  if (suggestion) {
    result += `\n  ${suggestion}`
  }
  return result
}

export function exitCodeFromError(error: UnifiedError): number {
  if (error.code.startsWith('USAGE_')) {
    return 2
  }
  return 1
}

function errorSuggestion(code: string): string | undefined {
  const suggestions: Record<string, string> = {
    USAGE_MISSING_ARG: 'Run with --help to see required arguments.',
    USAGE_INVALID_FLAG: 'Run with --help to see available flags.',
    USAGE_UNKNOWN_COMMAND: 'Run without arguments to see available commands.',
  }
  return suggestions[code]
}
