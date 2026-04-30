import type {
  ExecutionInput,
  ExecutionResult,
  IProvider,
  PluginManifest,
} from './types.js'
import {CommandRegistry} from './registry.js'
import {AuditLogger, isAuditDisabled} from './audit-log.js'

/**
 * Manifest 와 Provider 인스턴스를 묶어 실제 명령 실행을 수행하는 오케스트레이터.
 *
 * `init` hook 단계에서 전역 1개 인스턴스가 생성되며, 각 manifest 가
 * `registerManifest()` 로 추가되고 namespace 별 provider 가 `registerProvider()`
 * 로 등록된다. Runtime 에서는 oclif 가 생성한 BaseCommand 가 `execute(specId, input)`
 * 를 호출해 결과(`ExecutionResult`)를 받아 출력 포매팅에 사용한다.
 */
export interface ExecutorOptions {
  /** 명령 호출 기록을 받을 AuditLogger. 미주입 시 audit 비활성. */
  auditLogger?: AuditLogger | null
}

export class Executor {
  private providers = new Map<string, IProvider>()
  readonly registry = new CommandRegistry()
  private auditLogger: AuditLogger | null

  constructor(opts: ExecutorOptions = {}) {
    this.auditLogger = opts.auditLogger ?? null
  }

  /**
   * namespace 에 해당하는 Provider 인스턴스를 등록한다.
   *
   * Provider 는 manifest 등록 시점이 아니라 별도로 등록한다 — http/cli/python/js
   * 인스턴스 생성에 환경변수 해석 등 부수효과가 있어 hook 레이어에서 결정하기 때문.
   * @param namespace - PluginManifest.namespace (provider lookup 키)
   * @param provider - 해당 namespace 의 명령을 실행하는 IProvider 구현체
   */
  registerProvider(namespace: string, provider: IProvider): void {
    this.providers.set(namespace, provider)
  }

  /**
   * Manifest 를 내부 CommandRegistry 에 등록한다.
   * @param manifest - 검증된 PluginManifest
   * @throws {Error} 동일 namespace 가 이미 등록된 경우 (registry 위임)
   */
  registerManifest(manifest: PluginManifest): void {
    this.registry.register(manifest)
  }

  /**
   * 등록된 Provider 를 namespace 로 조회한다.
   * @param namespace - manifest namespace
   * @returns 등록된 Provider, 없으면 undefined
   */
  getProvider(namespace: string): IProvider | undefined {
    return this.providers.get(namespace)
  }

  /**
   * specId 로 명령을 찾아 해당 namespace 의 Provider 로 실행한다.
   *
   * 실행 중 발생하는 모든 에러를 `ExecutionResult.error` 로 정규화하여 throw 하지 않는다 —
   * CLI 레이어가 일관된 종료코드/JSON 출력을 만들 수 있도록 하기 위함.
   * - 명령 미발견: exitCode 2 (oclif 관용)
   * - provider 미등록 / 실행 중 throw: exitCode 1
   * @param specId - `${namespace}:${command.id}` 형식의 전체 ID
   * @param input - 파싱된 args/flags 와 raw argv
   * @returns 성공 여부, 데이터, 종료코드, 실행 시간(ms)을 담은 결과 객체
   */
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
      const finalResult: ExecutionResult = {
        ...result,
        duration: performance.now() - startTime,
      }
      this.recordAudit(spec.namespace, spec.id, finalResult, input)
      return finalResult
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const finalResult: ExecutionResult = {
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
      this.recordAudit(spec.namespace, spec.id, finalResult, input)
      return finalResult
    }
  }

  /**
   * AuditLogger 가 주입되어 있고 NO_AUDIT/--audit-off 가 아닐 때 호출 기록.
   * 실패 시 silently 무시 — audit 실패가 명령 실행을 막아서는 안 된다.
   */
  private recordAudit(
    namespace: string,
    command: string,
    result: ExecutionResult,
    input: ExecutionInput,
  ): void {
    if (!this.auditLogger || isAuditDisabled()) return
    void this.auditLogger
      .record({
        namespace,
        command,
        exitCode: result.exitCode,
        duration: result.duration,
        flags: input.flags as Record<string, unknown>,
        error: result.error?.message,
      })
      .catch(() => {
        // audit failure must not break command execution
      })
  }
}
