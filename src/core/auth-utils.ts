import type {PluginManifest, HttpProviderConfig, AuthConfig} from './types.js'

/** Extract AuthConfig from a manifest's provider config */
export function getAuthConfig(manifest: PluginManifest): AuthConfig | undefined {
  const config = manifest.provider.config as HttpProviderConfig
  return config?.auth
}

/** Get the executor from globalThis or throw */
export function getExecutor(): {registry: {getAllManifests(): PluginManifest[]}} {
  const executor = (globalThis as Record<string, unknown>).__unionCliExecutor as
    {registry: {getAllManifests(): PluginManifest[]}} | undefined
  if (!executor) throw new Error('Executor not initialized. Run "build" first.')
  return executor
}

/**
 * Manifest placeholder 치환.
 *
 * 지원 문법:
 *   ${ENV_VAR}                   → process.env.ENV_VAR (없으면 '')
 *   ${ENV_VAR:-default}          → process.env.ENV_VAR ?? 'default'
 *   ${@configKey}                → configValues['configKey'] (없으면 '')
 *   ${@configKey:-default}       → configValues['configKey'] ?? 'default'
 *   ${A:-${@b:-fallback}}        → 중첩 가능 (default 가 다시 placeholder 인 형태)
 *
 * `@` 접두사로 ConfigManager (`~/.<bin>/config.yaml`) 값을 참조한다.
 * env 와 config 가 모두 있으면 manifest 가 명시한 우선순위(작성 순서)를 그대로 따른다.
 *
 * 빈 brace `${}` 와 닫히지 않은 `${...` 는 원문 유지.
 */
export function resolveEnvVars(value: string, configValues?: Record<string, unknown>): string {
  const cfg = configValues ?? {}
  const env = process.env

  // brace-balanced 재귀 파서. `${A:-${@b:-x}}` 를 안전하게 해석.
  function resolve(input: string): string {
    let out = ''
    let i = 0
    while (i < input.length) {
      if (input[i] === '$' && input[i + 1] === '{') {
        let depth = 1
        let j = i + 2
        while (j < input.length && depth > 0) {
          if (input[j] === '$' && input[j + 1] === '{') {
            depth += 1
            j += 2
          } else if (input[j] === '}') {
            depth -= 1
            j += 1
          } else {
            j += 1
          }
        }
        if (depth !== 0) {
          // 닫는 brace 없음 — 원문 유지
          out += input.slice(i)
          return out
        }
        const expr = input.slice(i + 2, j - 1)
        out += evalExpr(expr)
        i = j
        continue
      }
      out += input[i]
      i += 1
    }
    return out
  }

  function evalExpr(expr: string): string {
    // 첫 ':-' 에서 split (default 부분이 placeholder 를 포함할 수 있으므로 indexOf 사용)
    const sepIdx = expr.indexOf(':-')
    let key = sepIdx >= 0 ? expr.slice(0, sepIdx) : expr
    const defaultRaw = sepIdx >= 0 ? expr.slice(sepIdx + 2) : ''
    // key/default 안의 placeholder 도 재귀적으로 해석
    key = resolve(key)
    if (key.startsWith('@')) {
      const configKey = key.slice(1)
      const v = cfg[configKey]
      if (v !== undefined && v !== null && v !== '') return String(v)
    } else if (key !== '') {
      const v = env[key]
      if (v !== undefined && v !== '') return v
    }
    return resolve(defaultRaw)
  }

  return resolve(value)
}

/**
 * 객체의 모든 string leaf 값에 resolveEnvVars 를 재귀 적용한다.
 *
 * 사용 시점: provider config 전체에 대해 manifest 의 `${ENV}` / `${@cfg}` 치환.
 * - object: 재귀
 * - array: 재귀 (원소별)
 * - string: resolve
 * - 그 외 (number/boolean/null): 그대로
 *
 * **주의**: 인풋 객체를 mutation 하지 않고 새 객체 반환 (deep clone with replaced strings).
 * 단 함수/클래스 인스턴스는 그대로 통과 (예: Node Buffer 같은 것은 재귀 안 함).
 */
export function resolveStringFields<T>(value: T, configValues?: Record<string, unknown>): T {
  if (typeof value === 'string') {
    return resolveEnvVars(value, configValues) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveStringFields(v, configValues)) as unknown as T
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveStringFields(v, configValues)
    }
    return out as unknown as T
  }
  return value
}

/** Determine if color/emoji should be suppressed */
export function isNoColor(flags: Record<string, unknown>): boolean {
  return Boolean(flags['no-color']) || process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb'
}
