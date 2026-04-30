import type {
  ExecutionInput,
  ExecutionResult,
  IProvider,
  PluginManifest,
} from './types.js'
import {CommandRegistry} from './registry.js'

export class Executor {
  private providers = new Map<string, IProvider>()
  readonly registry = new CommandRegistry()

  registerProvider(namespace: string, provider: IProvider): void {
    this.providers.set(namespace, provider)
  }

  registerManifest(manifest: PluginManifest): void {
    this.registry.register(manifest)
  }

  getProvider(namespace: string): IProvider | undefined {
    return this.providers.get(namespace)
  }

  async execute(specId: string, input: ExecutionInput): Promise<ExecutionResult> {
    const startTime = performance.now()

    const spec = this.registry.get(specId)
    if (!spec) {
      return {
        success: false,
        data: null,
        exitCode: 2,
        duration: performance.now() - startTime,
        error: {
          code: 'COMMAND_NOT_FOUND',
          message: `Command "${specId}"를 찾을 수 없습니다.`,
        },
      }
    }

    const provider = this.providers.get(spec.namespace)
    if (!provider) {
      return {
        success: false,
        data: null,
        exitCode: 1,
        duration: performance.now() - startTime,
        error: {
          code: 'PROVIDER_NOT_FOUND',
          message: `Provider for namespace "${spec.namespace}"를 찾을 수 없습니다.`,
        },
      }
    }

    try {
      const result = await provider.execute(spec, input)
      return {
        ...result,
        duration: performance.now() - startTime,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        exitCode: 1,
        duration: performance.now() - startTime,
        error: {
          code: 'EXECUTION_ERROR',
          message: msg,
          details: error instanceof Error ? error.stack : undefined,
        },
      }
    }
  }
}
