import type {
  IProvider,
  CommandSpec,
  ExecutionInput,
  ExecutionResult,
  HealthCheckResult,
  PluginManifest,
  HttpCommandConfig,
  HttpProviderConfig,
} from '../../core/types.js'
import {join} from 'node:path'
import {readFileSync} from 'node:fs'
import {applyAuth} from './auth-handlers.js'
import {resolveSecret, EnvCredentialStore} from '../../core/credential-store.js'
import {logger} from '../../core/logger.js'
import {AuthManager} from '../../core/auth.js'

/**
 * Replace {param} placeholders in a path template with values from args.
 * Throws if a required parameter is missing or empty.
 *
 * e.g. "/loadtests/{id}/stop" with {id: "lt-001"} -> "/loadtests/lt-001/stop"
 */
export function buildPath(pathTemplate: string, args: Record<string, unknown>): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_match, param: string) => {
    const value = args[param]
    // undefined / null / empty string은 모두 "누락"으로 간주한다.
    // (빈 값을 통과시키면 `/users//stop` 같은 깨진 경로가 만들어진다.)
    // 단, 숫자 0이나 boolean false는 유효한 값이므로 허용한다.
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing or empty path parameter: ${param}`)
    }
    return encodeURIComponent(String(value))
  })
}

/**
 * Build a URL query string from flags that have httpMap === 'query'.
 * Uses httpName as the query parameter key when defined, otherwise the flag name.
 *
 * 배열 값은 FlagSpec.httpQueryType에 따라 직렬화된다:
 *   - 'repeat' (기본): `?key=a&key=b`  (URLSearchParams.append)
 *   - 'csv'          : `?key=a,b`      (URLSearchParams.set with join)
 */
export function buildQueryParams(spec: CommandSpec, flags: Record<string, unknown>): string {
  const params = new URLSearchParams()

  for (const flagSpec of spec.flags) {
    if (flagSpec.httpMap !== 'query') continue
    const rawValue = flags[flagSpec.name]
    if (rawValue === undefined || rawValue === null) continue
    const key = flagSpec.httpName ?? flagSpec.name

    // httpQueryType이 설정되어 있고 값이 문자열이면 콤마 구분으로 배열 변환.
    // (CLI 사용자는 보통 `--ids "1,2,3"`처럼 입력하기 때문에, 이미 배열인 경우뿐 아니라
    //  이 경우도 원하는 직렬화 방식으로 처리해야 한다.)
    let value: unknown = rawValue
    if (flagSpec.httpQueryType && typeof rawValue === 'string') {
      value = rawValue.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    }

    if (Array.isArray(value)) {
      // 빈 배열은 어떤 직렬화 방식이든 쿼리 파라미터를 추가하지 않는다 (csv/repeat 일관성).
      if (value.length === 0) continue
      if (flagSpec.httpQueryType === 'csv') {
        params.set(key, value.map((v) => String(v)).join(','))
      } else {
        for (const item of value) {
          if (item === undefined || item === null) continue
          params.append(key, String(item))
        }
      }
      continue
    }

    params.set(key, String(value))
  }

  return params.toString()
}

/**
 * Build headers from flags that have httpMap === 'header'.
 * Uses httpName as the header name when defined, otherwise the flag name.
 * Returns an empty object if no header flags are present.
 */
export function buildHeaders(spec: CommandSpec, flags: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const flagSpec of spec.flags) {
    if (flagSpec.httpMap !== 'header') continue
    const value = flags[flagSpec.name]
    if (value === undefined || value === null) continue
    const key = flagSpec.httpName ?? flagSpec.name
    result[key] = String(value)
  }
  return result
}

/**
 * Coerce a flag value according to httpBodyType before placing it in the body.
 *   - 'json':               JSON.parse the string value (실패 시 원본 문자열 반환 + 경고)
 *   - 'array':              split comma-separated string → string[]
 *   - 'number-array':       split comma-separated string → number[] (NaN values are filtered out)
 *   - 'json-string-array':  JSON 파싱 후 각 원소를 JSON.stringify → string[]
 *                           (API가 객체가 아닌 JSON 문자열 배열을 기대할 때 사용)
 *                           단일 객체 입력 시 자동으로 배열로 감싸줌
 *   - undefined:            pass through as-is
 */
export function coerceBodyValue(value: unknown, bodyType?: string): unknown {
  if (bodyType === 'json' && typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      const preview = value.length > 80 ? value.slice(0, 80) + '...' : value
      logger.warn(
        `Warning: httpBodyType=json but value is not valid JSON: "${preview}" — passing as raw string.`,
      )
      return value
    }
  }

  if (bodyType === 'json-string-array' && typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      return items.map((item) =>
        typeof item === 'string' ? item : JSON.stringify(item),
      )
    } catch {
      const preview = value.length > 80 ? value.slice(0, 80) + '...' : value
      logger.warn(
        `Warning: httpBodyType=json-string-array but value is not valid JSON: "${preview}" — passing as raw string.`,
      )
      return [value]
    }
  }

  if (bodyType === 'array' && typeof value === 'string') {
    return value.split(',').map((s) => s.trim())
  }

  if (bodyType === 'number-array' && typeof value === 'string') {
    return value
      .split(',')
      .map((s) => {
        const n = Number(s.trim())
        if (Number.isNaN(n)) {
          logger.warn(`Warning: non-numeric value "${s.trim()}" in number-array, skipping`)
        }
        return n
      })
      .filter((n) => !Number.isNaN(n))
  }

  return value
}

/**
 * Build request body by merging static body from manifest with flags that have httpMap === 'body'.
 * Uses httpName as the body field key when defined, otherwise the flag name.
 * Returns null when the resulting body is empty (e.g. for GET requests).
 */
export function buildBody(
  spec: CommandSpec,
  flags: Record<string, unknown>,
  staticBody?: Record<string, unknown>,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = staticBody ? {...staticBody} : {}

  for (const flagSpec of spec.flags) {
    if (flagSpec.httpMap !== 'body') continue
    let value = flags[flagSpec.name]
    if (value === undefined || value === null) continue

    // valueFrom: 'file' — 파일 경로에서 내용을 읽어 값으로 사용
    if (flagSpec.valueFrom === 'file' && typeof value === 'string') {
      try {
        value = readFileSync(value, 'utf-8')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to read file "${value}": ${msg}`, {cause: err})
      }
    }

    const key = flagSpec.httpName ?? flagSpec.name
    body[key] = coerceBodyValue(value, flagSpec.httpBodyType)
  }

  return Object.keys(body).length > 0 ? body : null
}

/**
 * baseUrl + endpoint를 결합하되, endpoint가 절대 URL(http:// / https://)이면 그대로 사용한다.
 * baseUrl의 trailing slash와 endpoint의 leading slash를 정규화해 `//` 또는 결합 누락을 방지한다.
 *
 * 예:
 *   resolveEndpointUrl("http://api/v1",  "/login")                 → "http://api/v1/login"
 *   resolveEndpointUrl("http://api/v1/", "/login")                 → "http://api/v1/login"
 *   resolveEndpointUrl("http://api/v1",  "login")                  → "http://api/v1/login"
 *   resolveEndpointUrl("http://api/v1/", "login")                  → "http://api/v1/login"
 *   resolveEndpointUrl("http://api/v1",  "https://auth.example/t") → "https://auth.example/t"
 */
export function resolveEndpointUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint
  }
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const trimmedEndpoint = endpoint.replace(/^\/+/, '')
  return `${trimmedBase}/${trimmedEndpoint}`
}

/** 비어있지 않은 body에 대해서만 Content-Type 기본값을 부여한다(대소문자 무시 중복 방지). */
function hasHeader(headers: Record<string, unknown>, name: string): boolean {
  const target = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === target)
}

/** headers 객체에서 value가 undefined 또는 null인 엔트리를 제거한다. */
function stripEmptyHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue
    result[k] = String(v)
  }
  return result
}

/** Authorization 에러(JWT 발급 실패 등)를 나타내는 내부 예외. */
class HttpAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpAuthError'
  }
}

/**
 * Content-Type 헤더가 JSON 계열인지 판별.
 * 매칭: application/json, application/problem+json, application/ld+json, text/json 등.
 * 오탐 제외: foo/json-bar, jsonstuff 같은 임의 문자열.
 */
function isJsonContentType(ct: string): boolean {
  return /^\s*(?:application|text)\/(?:[\w.+-]+\+)?json(?:\s*;.*)?$/i.test(ct)
}

export class HTTPProvider implements IProvider {
  readonly type = 'http' as const
  private config: HttpProviderConfig
  private namespace: string
  private authManager: AuthManager

  constructor(config: HttpProviderConfig, namespace: string, authManager?: AuthManager) {
    this.config = config
    this.namespace = namespace
    this.authManager = authManager ?? new AuthManager(new EnvCredentialStore())
  }

  resolveCommands(_manifest: PluginManifest): CommandSpec[] {
    // Registry handles command resolution; return empty array
    return []
  }

  /**
   * YAML의 auth 설정 + 저장된 토큰 파일 / AuthManager를 기반으로 자격증명을 해석한다.
   *
   * 동작:
   *   - type: 'none' | undefined → null (헤더 변경 없음)
   *   - type: 'cookie'           → tokens.json에서 cookies 로드 (I/O 에러 유형별 로깅)
   *   - type: 'jwt'              → AuthManager.getAuthHeader로 토큰 발급/캐시. 실패 시 HttpAuthError throw.
   *   - 그 외                     → token / credentials.username / credentials.password secret ref 해석
   */
  private async resolveCredentials(): Promise<Record<string, string> | null> {
    const auth = this.config.auth
    if (!auth || auth.type === 'none') return null

    const creds: Record<string, string> = {}

    if (auth.type === 'cookie') {
      const tokenFile = auth.tokenFile ?? join(process.cwd(), '.union-cli', 'tokens.json')
      const serviceName = auth.serviceName ?? 'default'
      try {
        const {readFile} = await import('node:fs/promises')
        const content = await readFile(tokenFile, 'utf-8')
        const tokens = JSON.parse(content) as Record<string, {cookies?: string} | undefined>
        creds.cookies = tokens[serviceName]?.cookies ?? ''
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException
        if (nodeErr && nodeErr.code === 'ENOENT') {
          // 첫 로그인 전: 조용히 진행. 하류에서 "cookies empty" 경고를 낸다.
        } else if (nodeErr && nodeErr.code === 'EACCES') {
          logger.warn(`Warning: permission denied reading token file "${tokenFile}". Check file permissions.`)
        } else if (err instanceof SyntaxError) {
          logger.warn(`Warning: token file "${tokenFile}" is corrupted (invalid JSON): ${err.message}`)
        } else {
          logger.warn(`Warning: failed to read token file "${tokenFile}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      return creds
    }

    if (auth.type === 'device-code') {
      // Device Code Flow: tokens.json에서 저장된 access_token 사용, 만료 시 refresh_token으로 갱신
      const tokenFile = auth.tokenFile ?? join(process.cwd(), '.union-cli', 'tokens.json')
      const serviceName = auth.serviceName ?? this.namespace
      try {
        const {readFile, writeFile, mkdir} = await import('node:fs/promises')
        const content = await readFile(tokenFile, 'utf-8')
        const tokens = JSON.parse(content) as Record<string, {
          access_token?: string; refresh_token?: string;
          expires_in?: number; savedAt?: string; authType?: string;
        } | undefined>
        const stored = tokens[serviceName]
        if (!stored?.access_token) {
          throw new HttpAuthError(
            `Device code 인증이 필요합니다. 먼저 "auth login ${this.namespace}"을 실행하세요.`,
          )
        }

        // Check if token is expired and try refresh
        let accessToken = stored.access_token
        const savedAt = stored.savedAt ? new Date(stored.savedAt).getTime() : 0
        const expiresIn = (stored.expires_in ?? 300) * 1000
        const isExpired = Date.now() > savedAt + expiresIn - 30000 // 30s safety margin

        if (isExpired && stored.refresh_token && auth.tokenEndpoint && auth.clientId) {
          try {
            const params = new URLSearchParams()
            params.set('grant_type', 'refresh_token')
            params.set('client_id', auth.clientId)
            params.set('refresh_token', stored.refresh_token)

            const resp = await fetch(resolveEndpointUrl(this.config.baseUrl, auth.tokenEndpoint), {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body: params.toString(),
            })
            if (resp.ok) {
              const refreshed = await resp.json() as {
                access_token: string; refresh_token?: string; expires_in?: number;
              }
              accessToken = refreshed.access_token
              tokens[serviceName] = {
                access_token: refreshed.access_token,
                refresh_token: refreshed.refresh_token ?? stored.refresh_token,
                expires_in: refreshed.expires_in ?? stored.expires_in,
                savedAt: new Date().toISOString(),
                authType: 'device-code',
              }
              const dir = tokenFile.substring(0, tokenFile.lastIndexOf('/'))
              await mkdir(dir, {recursive: true})
              await writeFile(tokenFile, JSON.stringify(tokens, null, 2))
              logger.debug(`[device-code] ${this.namespace}: 토큰 자동 갱신 성공`)
            } else {
              logger.warn(`Warning: token refresh failed (${resp.status}). 재로그인이 필요할 수 있습니다.`)
            }
          } catch (refreshErr) {
            logger.warn(`Warning: token refresh error: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`)
          }
        }

        creds.token = accessToken
      } catch (err) {
        if (err instanceof HttpAuthError) throw err
        throw new HttpAuthError(
          `Device code 인증이 필요합니다. 먼저 "auth login ${this.namespace}"을 실행하세요.`,
        )
      }
      return creds
    }

    if (auth.type === 'jwt' && auth.tokenEndpoint) {
      // Delegate JWT token management to AuthManager (single source of truth)
      try {
        const authHeaders = await this.authManager.getAuthHeader(this.namespace, {
          ...auth,
          tokenEndpoint: resolveEndpointUrl(this.config.baseUrl, auth.tokenEndpoint),
        })
        const bearerHeader = authHeaders['Authorization']
        if (!bearerHeader) {
          // 토큰이 비어 있거나 credentials가 없어 AuthManager가 빈 헤더를 반환한 경우.
          throw new HttpAuthError('JWT authentication failed: no token returned (check credentials).')
        }
        creds.token = bearerHeader.replace(/^Bearer\s+/, '')
      } catch (err) {
        if (err instanceof HttpAuthError) throw err
        throw new HttpAuthError(
          `JWT token request error: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      return creds
    }

    if (auth.token) creds.token = (await resolveSecret(auth.token)) ?? ''
    if (auth.credentials?.username) creds.username = (await resolveSecret(auth.credentials.username)) ?? ''
    if (auth.credentials?.password) creds.password = (await resolveSecret(auth.credentials.password)) ?? ''

    return creds
  }

  async execute(spec: CommandSpec, input: ExecutionInput): Promise<ExecutionResult> {
    const httpConfig = spec.providerConfig as HttpCommandConfig
    const startTime = performance.now()

    // 1. Build URL: replace path parameters {name} with input.args[name]
    let url: string
    try {
      url = resolveEndpointUrl(this.config.baseUrl, buildPath(httpConfig.path, input.args))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        exitCode: 1,
        duration: performance.now() - startTime,
        error: {code: 'HTTP_PATH_ERROR', message},
      }
    }

    // 2. Build query string from flags with httpMap: 'query'
    const queryParams = buildQueryParams(spec, input.flags)
    if (queryParams) url += '?' + queryParams

    // 3. Build request body from flags with httpMap: 'body' + static body from manifest
    const body = buildBody(spec, input.flags, httpConfig.body)

    // 4. Resolve credentials (JWT 실패 시 즉시 HTTP_AUTH_ERROR로 단락)
    let credentials: Record<string, string> | null
    try {
      credentials = await this.resolveCredentials()
    } catch (err) {
      if (err instanceof HttpAuthError) {
        return {
          success: false,
          data: null,
          exitCode: 1,
          duration: performance.now() - startTime,
          error: {code: 'HTTP_AUTH_ERROR', message: err.message},
        }
      }
      throw err
    }

    // 5. Build headers: config.headers → flag-based headers → Content-Type(조건부) → applyAuth
    //    순서가 중요: auth가 맨 마지막에 적용되어 명시적 auth 헤더로 flag/config를 오버라이드.
    const headers: Record<string, string | undefined> = {
      ...this.config.headers,
      ...buildHeaders(spec, input.flags),
    }
    if (body != null && !hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    let finalHeaders = stripEmptyHeaders(headers)
    finalHeaders = applyAuth(finalHeaders, this.config.auth, credentials)

    // 6. Execute fetch
    try {
      const response = await fetch(url, {
        method: httpConfig.method,
        headers: finalHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeout ?? 30000),
      })

      let data: unknown
      const contentType = response.headers.get('content-type') ?? ''
      if (isJsonContentType(contentType)) {
        const text = await response.text()
        try {
          data = JSON.parse(text)
        } catch {
          data = text  // fallback to raw text if JSON parsing fails
        }
      } else {
        data = await response.text()
      }

      return {
        success: response.ok,
        data,
        exitCode: response.ok ? 0 : 1,
        duration: performance.now() - startTime,
        error: response.ok
          ? undefined
          : {
              code: `HTTP_${response.status}`,
              message: `HTTP ${response.status} ${response.statusText}`,
              details: data,
            },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        exitCode: 1,
        duration: performance.now() - startTime,
        error: {code: 'HTTP_ERROR', message},
      }
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      // 인증된 API의 경우 auth 헤더가 없으면 401이 나오므로, 가능한 한 적용한다.
      // 단, auth 해석 자체가 실패해도(JWT endpoint 불가 등) healthcheck는 계속 진행한다.
      let authHeaders: Record<string, string> = {}
      try {
        const credentials = await this.resolveCredentials()
        authHeaders = applyAuth({}, this.config.auth, credentials)
      } catch {
        // auth 해석 실패: 헤더 없이 단순 reachability만 확인
      }

      const response = await fetch(this.config.baseUrl, {
        method: 'GET',
        headers: authHeaders,
        signal: AbortSignal.timeout(5000),
      })

      // 401/403은 "네트워크로는 도달 가능"을 의미하지만 건강한 상태는 아니다.
      const authProblem = response.status === 401 || response.status === 403
      const message = response.ok
        ? `${this.config.baseUrl} is reachable`
        : authProblem
        ? `${this.config.baseUrl} reachable but authentication required (HTTP ${response.status})`
        : `${this.config.baseUrl} returned HTTP ${response.status}`

      return {
        healthy: response.ok,
        message,
        details: {status: response.status, statusText: response.statusText},
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        healthy: false,
        message: `${this.config.baseUrl} is not reachable: ${message}`,
      }
    }
  }
}

