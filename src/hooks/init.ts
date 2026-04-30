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

// 글로벌 Executor 인스턴스 (커맨드에서 접근)
export const executor = new Executor()

// 모든 HTTPProvider가 공유하는 AuthManager — JWT 캐시를 namespace 단위로 공유해 재발급 낭비를 막는다.
const sharedAuthManager = new AuthManager(new EnvCredentialStore())

/** 환경변수 참조를 해석: ${VAR_NAME} 또는 ${VAR_NAME:-default} */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [envKey, defaultValue] = expr.split(':-')
    return process.env[envKey] ?? defaultValue ?? ''
  })
}


function isHttpProviderConfig(config: unknown): config is HttpProviderConfig {
  return typeof config === 'object' && config !== null && 'baseUrl' in config
}

function createProvider(manifest: PluginManifest): IProvider | null {
  switch (manifest.provider.type) {
    case 'http': {
      if (!isHttpProviderConfig(manifest.provider.config)) {
        throw new Error(`Namespace "${manifest.namespace}": http provider requires a valid config with baseUrl`)
      }
      const rawConfig = manifest.provider.config
      const config: HttpProviderConfig = {
        ...rawConfig,
        baseUrl: resolveEnvVars(rawConfig.baseUrl),
      }
      return new HTTPProvider(config, manifest.namespace, sharedAuthManager)
    }
    case 'cli': {
      return new CLIProvider(manifest.provider.config as CliProviderConfig, manifest.namespace)
    }
    case 'python': {
      const rawConfig = manifest.provider.config as PythonProviderConfig
      const config: PythonProviderConfig = {
        ...rawConfig,
        ...(rawConfig.venv && {venv: resolveEnvVars(rawConfig.venv)}),
      }
      return new PythonProvider(config)
    }
    case 'js': {
      return new JSProvider(manifest.provider.config as JsProviderConfig)
    }
    default:
      return null
  }
}

const hook: Hook<'init'> = async function (_options) {
  const cacheDir = join(process.cwd(), CACHE_DIR)
  const cachePath = join(cacheDir, MANIFEST_FILE)

  if (!existsSync(cachePath)) {
    return
  }

  try {
    const content = await readFile(cachePath, 'utf-8')
    const manifests: PluginManifest[] = JSON.parse(content)

    for (const manifest of manifests) {
      executor.registerManifest(manifest)

      // Provider 자동 등록
      const provider = createProvider(manifest)
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
