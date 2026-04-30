import type {
  IProvider,
  CliProviderConfig,
  CliCommandConfig,
  CommandSpec,
  ExecutionInput,
  ExecutionResult,
  PluginManifest,
} from '../../core/types.js'
import {spawnProcess} from './process.js'
import {parseOutput} from './output-parser.js'

/**
 * Sanitize a value for use as a CLI argument.
 *
 * Since we use spawn() with an args array (not exec() with a shell string),
 * actual shell injection is not possible. However, we still need to ensure
 * that substituted values are treated as single arguments and don't interfere
 * with argument parsing.
 */
export function sanitizeArg(value: string): string {
  // Remove null bytes which can cause issues in argument processing
  return value.replace(/\0/g, '')
}

/**
 * Build the CLI argument array from a CommandSpec and ExecutionInput.
 *
 * 1. Start with cliTemplate, replacing {argName} placeholders with input.args values.
 *    Values containing spaces are preserved as single arguments (not split).
 * 2. For each flag that has a value in input.flags and a cliMap defined:
 *    - Boolean flag with value true: append the cliMap literally (e.g. "--all-namespaces")
 *    - Non-boolean flag: replace {value} in cliMap with the flag value.
 *      The value portion is kept as a single argument.
 * 3. Append globalFlags unless overrideGlobalFlags is set.
 */
export function buildCliArgs(
  spec: CommandSpec,
  input: ExecutionInput,
  globalFlags?: string[],
): string[] {
  const cliConfig = spec.providerConfig as CliCommandConfig

  // Step 1: Process cliTemplate — replace {argName} placeholders.
  // We use a sentinel-based approach so that substituted values with spaces
  // are not split by the whitespace tokenizer.
  const SENTINEL = '\x01'
  let template = cliConfig.cliTemplate
  const replacements: Map<string, string> = new Map()
  let counter = 0

  for (const [key, value] of Object.entries(input.args)) {
    const sanitized = sanitizeArg(String(value))
    const placeholder = `${SENTINEL}${counter}${SENTINEL}`
    replacements.set(placeholder, sanitized)
    template = template.replace(`{${key}}`, placeholder)
    counter++
  }

  // Split by whitespace, then restore sentinels to original values
  const args = template.split(/\s+/).filter(Boolean).map((token) => {
    for (const [placeholder, original] of replacements) {
      if (token.includes(placeholder)) {
        return token.replace(placeholder, original)
      }
    }
    return token
  })

  // Step 2: Process flags with cliMap
  for (const flagSpec of spec.flags) {
    const flagValue = input.flags[flagSpec.name]
    if (flagValue === undefined || flagValue === null || flagValue === false) continue
    if (!flagSpec.cliMap) continue

    if (flagSpec.type === 'boolean' && flagValue === true) {
      // Boolean flag: append cliMap as-is (e.g. "--all-namespaces")
      args.push(...flagSpec.cliMap.split(/\s+/).filter(Boolean))
    } else {
      // Non-boolean: replace {value} in cliMap.
      // Split first, then substitute the value in each part.
      // This ensures the flag name and value are separate args,
      // but the value itself is not split on spaces.
      const sanitized = sanitizeArg(String(flagValue))
      const parts = flagSpec.cliMap.split(/\s+/).filter(Boolean)
      for (const part of parts) {
        if (part.includes('{value}')) {
          args.push(part.replace('{value}', sanitized))
        } else {
          args.push(part)
        }
      }
    }
  }

  // Step 3: Append globalFlags unless overridden
  if (!cliConfig.overrideGlobalFlags && globalFlags && globalFlags.length > 0) {
    args.push(...globalFlags)
  }

  return args
}

export class CLIProvider implements IProvider {
  readonly type = 'cli' as const
  private config: CliProviderConfig
  private namespace: string

  constructor(config: CliProviderConfig, namespace: string) {
    this.config = config
    this.namespace = namespace
  }

  resolveCommands(_manifest: PluginManifest): CommandSpec[] {
    // Registry handles command resolution; return empty array
    return []
  }

  async execute(spec: CommandSpec, input: ExecutionInput): Promise<ExecutionResult> {
    const cliConfig = spec.providerConfig as CliCommandConfig
    const startTime = performance.now()

    const args = buildCliArgs(spec, input, this.config.globalFlags)

    try {
      const result = await spawnProcess({
        binary: this.config.binary,
        args,
      })

      if (result.exitCode !== 0) {
        return {
          success: false,
          data: result.stderr || result.stdout,
          exitCode: result.exitCode,
          duration: performance.now() - startTime,
          error: {
            code: 'CLI_ERROR',
            message: result.stderr.trim() || `Command exited with code ${result.exitCode}`,
          },
        }
      }

      const parsed = parseOutput(result.stdout, cliConfig.outputParser)

      return {
        success: true,
        data: parsed,
        exitCode: 0,
        duration: performance.now() - startTime,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        exitCode: 1,
        duration: performance.now() - startTime,
        error: {
          code: 'CLI_EXECUTION_ERROR',
          message,
        },
      }
    }
  }

  async healthCheck(): Promise<{healthy: boolean; message: string; details?: unknown}> {
    try {
      const result = await spawnProcess({
        binary: this.config.binary,
        args: ['version'],
        timeout: 5000,
      })

      if (result.exitCode === 0) {
        return {
          healthy: true,
          message: `${this.config.binary} is available`,
          details: result.stdout.trim(),
        }
      }

      // Fallback: try --version
      const fallback = await spawnProcess({
        binary: this.config.binary,
        args: ['--version'],
        timeout: 5000,
      })

      return {
        healthy: fallback.exitCode === 0,
        message: fallback.exitCode === 0
          ? `${this.config.binary} is available`
          : `${this.config.binary} health check failed with exit code ${fallback.exitCode}`,
        details: fallback.stdout.trim() || fallback.stderr.trim(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        healthy: false,
        message: `${this.config.binary} is not available: ${message}`,
      }
    }
  }
}
