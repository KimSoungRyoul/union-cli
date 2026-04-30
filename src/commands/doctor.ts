import {Command, Flags} from '@oclif/core'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {CACHE_DIR, MANIFEST_FILE} from '../core/constants.js'
import {isNoColor} from '../core/auth-utils.js'

interface ExecutorLike {
  registry: {
    getAllManifests(): {namespace: string; provider: {type: string; config: unknown}}[]
  }
  getProvider(ns: string): {healthCheck?(): Promise<{healthy: boolean; message: string}>} | undefined
}

interface CheckResult {
  node: {status: string; version: string}
  cwd: {status: string; path: string}
  manifests: {status: string; count: number}
  tokens: {status: string}
  providers: {namespace: string; status: string; message?: string}[]
}

export default class Doctor extends Command {
  static override description = '시스템 상태 확인'

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
    'no-color': Flags.boolean({description: '색상/이모지 비활성화'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const noColor = isNoColor(flags)
    const ok = noColor ? '[OK]' : '✓'
    const fail = noColor ? '[X]' : '✗'

    const cachePath = join(process.cwd(), CACHE_DIR, MANIFEST_FILE)
    const tokensPath = join(process.cwd(), CACHE_DIR, 'tokens.json')

    // System checks
    let manifests: {namespace: string; provider: {type: string; config: unknown}}[] = []
    let executor: ExecutorLike | null = null
    try {
      const raw = (globalThis as Record<string, unknown>).__unionCliExecutor as ExecutorLike | undefined
      if (raw) {
        executor = raw
        manifests = executor.registry.getAllManifests()
      }
    } catch {
      // Executor not initialized — still report system checks
    }

    const checks: CheckResult = {
      node: {status: 'ok', version: process.version},
      cwd: {status: 'ok', path: process.cwd()},
      manifests: {status: existsSync(cachePath) ? 'ok' : 'missing', count: manifests.length},
      tokens: {status: existsSync(tokensPath) ? 'ok' : 'missing'},
      providers: [],
    }

    // Provider health checks
    if (executor) {
      for (const m of manifests) {
        const provider = executor.getProvider(m.namespace)
        if (provider?.healthCheck) {
          try {
            const result = await provider.healthCheck()
            checks.providers.push({
              namespace: m.namespace,
              status: result.healthy ? 'ok' : 'error',
              message: result.message,
            })
          } catch (error) {
            checks.providers.push({
              namespace: m.namespace,
              status: 'unreachable',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        } else {
          checks.providers.push({
            namespace: m.namespace,
            status: 'ok',
            message: 'no health check',
          })
        }
      }
    }

    if (flags.json) {
      this.log(JSON.stringify(checks, null, 2))
      return
    }

    this.logToStderr('시스템 상태:')
    this.logToStderr(`  Node.js: ${process.version} ${ok}`)
    this.logToStderr(`  작업 디렉토리: ${process.cwd()} ${ok}`)
    this.logToStderr(`  매니페스트: ${checks.manifests.count}개 ${checks.manifests.status === 'ok' ? ok : fail + ' (빌드 필요)'}`)
    this.logToStderr(`  토큰: ${checks.tokens.status === 'ok' ? ok : fail + ' (auth login 필요)'}`)
    this.logToStderr('')
    this.logToStderr('Provider 상태:')
    if (checks.providers.length === 0) {
      this.logToStderr(`  (등록된 provider 없음)`)
    } else {
      for (const p of checks.providers) {
        const icon = p.status === 'ok' ? ok : fail
        this.logToStderr(`  ${p.namespace}: ${icon} ${p.status}${p.message && p.status !== 'ok' ? ` (${p.message})` : ''}`)
      }
    }
  }
}
