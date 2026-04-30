import type {
  IProvider,
  CommandSpec,
  ExecutionInput,
  ExecutionResult,
  HealthCheckResult,
  PluginManifest,
  JsCommandConfig,
  JsProviderConfig,
} from '../../core/types.js'
import {loadModule, callFunction} from './loader.js'

export class JSProvider implements IProvider {
  readonly type = 'js' as const
  private config: JsProviderConfig
  private moduleCache = new Map<string, Record<string, unknown>>()

  constructor(config: JsProviderConfig) {
    this.config = config
  }

  resolveCommands(_manifest: PluginManifest): CommandSpec[] {
    return []
  }

  async execute(spec: CommandSpec, input: ExecutionInput): Promise<ExecutionResult> {
    const jsConfig = spec.providerConfig as JsCommandConfig
    const startTime = performance.now()

    try {
      // Load module (with caching)
      let mod = this.moduleCache.get(jsConfig.module)
      if (!mod) {
        mod = await loadModule(jsConfig.module)
        this.moduleCache.set(jsConfig.module, mod)
      }

      // Build args object: merge args and flags
      const callArgs = {...input.args, ...input.flags}

      const data = await callFunction(mod, jsConfig.function, callArgs)
      return {success: true, data, exitCode: 0, duration: performance.now() - startTime}
    } catch (error) {
      return {
        success: false,
        data: null,
        exitCode: 1,
        duration: performance.now() - startTime,
        error: {
          code: 'JS_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      await loadModule(this.config.module)
      return {healthy: true, message: 'Module loaded successfully'}
    } catch (error) {
      return {
        healthy: false,
        message: `Module load failed: ${error instanceof Error ? error.message : error}`,
      }
    }
  }
}
