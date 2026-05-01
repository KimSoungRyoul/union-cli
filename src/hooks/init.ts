import {type Hook} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import type {PluginManifest, HttpProviderConfig, CliProviderConfig, PythonProviderConfig, JsProviderConfig, IProvider} from '../core/types.js'
import {Executor} from '../core/executor.js'
import {HTTPProvider} from '../providers/http/provider.js'
import {CLIProvider} from '../providers/cli/provider.js'
import {PythonProvider} from '../providers/python/provider.js'
import {JSProvider} from '../providers/js/provider.js'
import {CACHE_DIR, MANIFEST_FILE} from '../core/constants.js'
import {logger} from '../core/logger.js'
import {AuthManager} from '../core/auth.js'
import {EnvCredentialStore} from '../core/credential-store.js'
import {ConfigManager} from '../core/config.js'
import {resolveStringFields} from '../core/auth-utils.js'
import {AuditLogger, isAuditDisabled} from '../core/audit-log.js'
import {createCredentialStore} from '../core/credential-store.js'

// 글로벌 Executor 인스턴스 (커맨드에서 접근)
export const executor = new Executor()

// env-store 기반 sharedAuthManager — credentialStore 가 명시되지 않은 manifest (대다수) 의 default.
// JWT 캐시를 namespace 단위로 공유해 재발급 낭비를 막는다.
const sharedAuthManager = new AuthManager(new EnvCredentialStore())

// manifest 가 keychain/file 등 별도 store 를 명시한 경우, manifest-specific AuthManager 를 만들어 캐싱.
// 같은 store 종류는 재사용해 메모리 낭비 방지.
const authManagerCache = new Map<string, AuthManager>()


function isHttpProviderConfig(config: unknown): config is HttpProviderConfig {
  return typeof config === 'object' && config !== null && 'baseUrl' in config
}

function createProvider(manifest: PluginManifest, configValues: Record<string, unknown>, cliName: string): IProvider | null {
  switch (manifest.provider.type) {
    case 'http': {
      if (!isHttpProviderConfig(manifest.provider.config)) {
        throw new Error(`Namespace "${manifest.namespace}": http provider requires a valid config with baseUrl`)
      }
      // baseUrl 뿐 아니라 headers.* / auth.tokenEndpoint / auth.deviceAuthEndpoint /
      // tls.caFile / tls.certFile / tls.keyFile / tls.servername 등 모든 string field 재귀 치환
      const config = resolveStringFields(manifest.provider.config, configValues) as HttpProviderConfig
      // credentialStore 옵션에 따라 적절한 store 선택. default 'env' 는 sharedAuthManager 재사용.
      const storeType = config.credentialStore ?? 'env'
      let authManager = sharedAuthManager
      if (storeType !== 'env') {
        const cacheKey = storeType
        let mgr = authManagerCache.get(cacheKey)
        if (!mgr) {
          const store = createCredentialStore({type: storeType, cliName, fallbackToFile: true})
          mgr = new AuthManager(store)
          authManagerCache.set(cacheKey, mgr)
        }
        authManager = mgr
      }
      return new HTTPProvider(config, manifest.namespace, authManager)
    }
    case 'cli': {
      return new CLIProvider(manifest.provider.config as CliProviderConfig, manifest.namespace)
    }
    case 'python': {
      const rawConfig = manifest.provider.config as PythonProviderConfig
      const config = resolveStringFields(rawConfig, configValues) as PythonProviderConfig
      return new PythonProvider(config)
    }
    case 'js': {
      return new JSProvider(manifest.provider.config as JsProviderConfig)
    }
    default:
      return null
  }
}

const hook: Hook<'init'> = async function (options) {
  const cacheDir = join(process.cwd(), CACHE_DIR)
  const cachePath = join(cacheDir, MANIFEST_FILE)

  if (!existsSync(cachePath)) {
    return
  }

  const cliName = options.config?.bin ?? 'union-cli'

  // ~/.<bin>/config.yaml 의 사용자 설정값을 1회 로드 — manifest 의 ${@key} placeholder 치환에 사용.
  // 파일이 없으면 빈 객체로 fallback (graceful).
  let configValues: Record<string, unknown> = {}
  try {
    configValues = new ConfigManager(cliName).loadSync()
  } catch (err) {
    logger.warn(`사용자 설정 로딩 실패 (무시하고 진행): ${err instanceof Error ? err.message : err}`)
  }

  // Audit logger — NO_AUDIT/--audit-off 가 아니면 활성. 명령 실행마다 ~/.<cli>/audit.log 에 JSONL 기록.
  if (!isAuditDisabled()) {
    try {
      executor.setAuditLogger(new AuditLogger({cliName, enabled: true}))
    } catch (err) {
      logger.warn(`audit logger 초기화 실패 (audit 비활성): ${err instanceof Error ? err.message : err}`)
    }
  }

  try {
    const content = await readFile(cachePath, 'utf-8')
    const manifests: PluginManifest[] = JSON.parse(content)

    for (const manifest of manifests) {
      executor.registerManifest(manifest)

      // Provider 자동 등록
      const provider = createProvider(manifest, configValues, cliName)
      if (provider) {
        executor.registerProvider(manifest.namespace, provider)
      }
    }

    // globalThis에 executor 노출 (codegen 커맨드에서 접근)
    ;(globalThis as Record<string, unknown>).__unionCliExecutor = executor

    logger.debug(`Initialized ${manifests.length} manifests`)
  } catch (error) {
    logger.warn(`manifest.json 로딩 실패: ${error instanceof Error ? error.message : error}`)
  }
}

export default hook
