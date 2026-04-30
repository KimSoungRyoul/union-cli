import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
import type {
  IProvider,
  CommandSpec,
  ExecutionInput,
  ExecutionResult,
  HealthCheckResult,
  PluginManifest,
  PythonCommandConfig,
  PythonProviderConfig,
} from '../../core/types.js'
import {PythonBridge} from './bridge.js'

/**
 * Build kwargs from a CommandSpec and ExecutionInput.
 *
 * - args are passed through directly.
 * - flags are mapped using pythonName when defined,
 *   otherwise the flag name with dashes replaced by underscores.
 */
export function buildKwargs(
  spec: CommandSpec,
  input: ExecutionInput,
): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {...input.args}

  for (const flagSpec of spec.flags) {
    const value = input.flags[flagSpec.name]
    if (value === undefined) continue
    const pyName = flagSpec.pythonName ?? flagSpec.name.replace(/-/g, '_')
    kwargs[pyName] = value
  }

  return kwargs
}

export class PythonProvider implements IProvider {
  readonly type = 'python' as const
  private bridge: PythonBridge
  private config: PythonProviderConfig

  constructor(config: PythonProviderConfig) {
    this.config = config
    this.bridge = new PythonBridge({
      module: config.module,
      persistent: config.persistent ?? false,
      idleTimeout: config.idleTimeout ?? 300_000,
      venv: config.venv,
    })
  }

  resolveCommands(_manifest: PluginManifest): CommandSpec[] {
    // Registry handles command resolution; return empty array
    return []
  }

  async execute(spec: CommandSpec, input: ExecutionInput): Promise<ExecutionResult> {
    const pyConfig = spec.providerConfig as PythonCommandConfig
    const startTime = performance.now()

    const kwargs = buildKwargs(spec, input)

    try {
      const result = await this.bridge.call(pyConfig.function, kwargs)
      return {
        success: result.success,
        data: result.data,
        exitCode: result.success ? 0 : 1,
        duration: performance.now() - startTime,
        error: result.error
          ? {code: 'PYTHON_ERROR', message: result.error}
          : undefined,
      }
    } catch (error) {
      return {
        success: false,
        data: null,
        exitCode: 1,
        duration: performance.now() - startTime,
        error: {
          code: 'PYTHON_BRIDGE_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const pythonPath = this.config.venv
      ? resolve(this.config.venv, 'bin', 'python3')
      : 'python3'

    try {
      const proc = spawn(pythonPath, ['--version'])
      return new Promise((resolvePromise) => {
        let stdout = ''
        proc.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        proc.on('close', (code) => {
          resolvePromise({
            healthy: code === 0,
            message: code === 0 ? 'Python available' : 'Python not found',
            details: stdout.trim() || undefined,
          })
        })
        proc.on('error', () => {
          resolvePromise({healthy: false, message: 'Python not found'})
        })
      })
    } catch {
      return {healthy: false, message: 'Python not found'}
    }
  }
}
