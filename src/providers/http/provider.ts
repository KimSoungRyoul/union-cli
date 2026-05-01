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
import {readProxyEnv, createDispatcher} from '../../core/proxy-utils.js'
import {readTlsConfig, createTlsDispatcher} from '../../core/tls-utils.js'

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
      // logger.warn 은 default level 보다 낮을 수 있어 사용자에게 안 보임 → stderr 직접
      process.stderr.write(
        `[union-cli warning] httpBodyType=json but value is not valid JSON: "${preview}" — passing as raw string.\n`,
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
      process.stderr.write(
        `[union-cli warning] httpBodyType=json-string-array but value is not valid JSON: "${preview}" — passing as raw string.\n`,
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

// ── Pagination ───────────────────────────────────────────────────────────────
// HTTP API의 cursor / offset / link-header 3종 페이지네이션을 manifest 선언만으로 지원.
// `pagination` 설정이 provider.config 에 있고 실행 시 `flags.all === true` 이면
// 모든 페이지를 누적해 ExecutionResult.data 에 단일 배열로 반환한다.
//
// schema.ts 는 이 파일에서 직접 수정하지 않는다 (Coordinator가 schema_spec 으로 통합).
// 런타임 검증은 아래 normalizePaginationConfig 가 담당한다.

/** Manifest 의 provider.config.pagination 선언과 1:1 매핑. */
export interface PaginationConfig {
  style: 'cursor' | 'offset' | 'link-header'
  /** 다음 페이지를 요청할 때 query string 에 실어보낼 파라미터 이름 (cursor/offset 공용). */
  pageParam?: string
  /** 페이지 크기를 query string 에 실어보낼 파라미터 이름. */
  sizeParam?: string
  /**
   * 응답 본문에서 누적할 items 위치를 가리키는 dot-path.
   * 예) "data" → body.data,  "results.items" → body.results.items.
   * 미지정이고 응답 자체가 array 면 그대로 사용한다.
   */
  itemsPath?: string
  /** cursor 스타일에서 "다음 cursor" 값이 들어 있는 dot-path. */
  nextPath?: string
  /** 안전 한계 — 무한 루프 방지. 기본 100. */
  maxPages?: number
  /** 첫 요청에 sizeParam 으로 자동 주입할 기본 page size. 미지정 시 주입하지 않는다. */
  perPage?: number
}

/** 정규화된 pagination 설정 — 기본값 적용 후 내부에서 사용. */
interface NormalizedPaginationConfig {
  style: 'cursor' | 'offset' | 'link-header'
  pageParam?: string
  sizeParam?: string
  itemsPath?: string
  nextPath?: string
  maxPages: number
  perPage?: number
}

/**
 * 사용자 입력 pagination 설정을 정규화한다.
 *   - style 검증 (cursor / offset / link-header 만 허용)
 *   - maxPages 기본값 100, 양의 정수 강제
 *   - cursor 스타일은 pageParam + nextPath 가 함께 필요
 *   - offset 스타일은 pageParam 이 필요
 * 잘못된 입력은 명확한 메시지의 Error 로 throw 한다.
 */
export function normalizePaginationConfig(raw: unknown): NormalizedPaginationConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('pagination config must be an object')
  }
  const cfg = raw as Record<string, unknown>
  const style = cfg.style
  if (style !== 'cursor' && style !== 'offset' && style !== 'link-header') {
    throw new Error(
      `pagination.style must be one of 'cursor' | 'offset' | 'link-header' (got ${JSON.stringify(style)})`,
    )
  }

  const maxPagesRaw = cfg.maxPages
  let maxPages = 100
  if (maxPagesRaw !== undefined) {
    if (typeof maxPagesRaw !== 'number' || !Number.isFinite(maxPagesRaw) || maxPagesRaw < 1 || !Number.isInteger(maxPagesRaw)) {
      throw new Error('pagination.maxPages must be a positive integer')
    }
    maxPages = maxPagesRaw
  }

  const perPageRaw = cfg.perPage
  let perPage: number | undefined
  if (perPageRaw !== undefined) {
    if (typeof perPageRaw !== 'number' || !Number.isFinite(perPageRaw) || perPageRaw < 1 || !Number.isInteger(perPageRaw)) {
      throw new Error('pagination.perPage must be a positive integer')
    }
    perPage = perPageRaw
  }

  const pageParam = typeof cfg.pageParam === 'string' && cfg.pageParam.length > 0 ? cfg.pageParam : undefined
  const sizeParam = typeof cfg.sizeParam === 'string' && cfg.sizeParam.length > 0 ? cfg.sizeParam : undefined
  const itemsPath = typeof cfg.itemsPath === 'string' && cfg.itemsPath.length > 0 ? cfg.itemsPath : undefined
  const nextPath = typeof cfg.nextPath === 'string' && cfg.nextPath.length > 0 ? cfg.nextPath : undefined

  if (style === 'cursor') {
    if (!pageParam) throw new Error("pagination.pageParam is required for style='cursor'")
    if (!nextPath) throw new Error("pagination.nextPath is required for style='cursor'")
  }
  if (style === 'offset') {
    if (!pageParam) throw new Error("pagination.pageParam is required for style='offset'")
  }

  return {style, pageParam, sizeParam, itemsPath, nextPath, maxPages, perPage}
}

/**
 * dot-path 로 객체에서 값을 안전하게 추출한다.
 *   getByPath({a:{b:[1,2]}}, "a.b") → [1,2]
 *   getByPath({}, "x.y")            → undefined
 * 중간에 null/undefined/non-object 가 나오면 undefined.
 * path 가 빈 문자열이면 root 객체를 그대로 반환한다.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/**
 * RFC 5988 Link 헤더에서 rel="next" URL 을 추출한다.
 *   Link: <https://api/items?page=2>; rel="next", <...>; rel="last"
 *   → "https://api/items?page=2"
 * rel="next" 가 없으면 null.
 */
export function parseLinkHeaderNext(linkHeader: string | null | undefined): string | null {
  if (!linkHeader) return null
  // 콤마로 split 하되 URL 내부의 콤마는 < > 로 보호되므로 단순 split 으로 충분.
  // (RFC 5988 의 정식 파서는 더 복잡하지만 일반적인 케이스는 이걸로 처리됨.)
  for (const rawPart of linkHeader.split(',')) {
    const part = rawPart.trim()
    const m = part.match(/^<([^>]+)>\s*;\s*(.+)$/)
    if (!m) continue
    const url = m[1]
    const params = m[2]
    // rel="next" 또는 rel=next (따옴표 없음)
    const relMatch = params?.match(/\brel\s*=\s*"?([^",;\s]+)"?/i)
    if (relMatch && relMatch[1]?.toLowerCase() === 'next' && url) {
      return url
    }
  }
  return null
}

/** url 에 query parameter 를 추가/오버라이드한다. */
function setQueryParam(url: string, key: string, value: string): string {
  const [base, query = ''] = url.split('?', 2) as [string, string?]
  const params = new URLSearchParams(query)
  params.set(key, value)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** 두 URL 이 동일한 endpoint 를 가리키는지 빠르게 비교 (무한 루프 가드용). */
function sameEndpoint(a: string, b: string): boolean {
  // 단순 비교 — 쿼리 정렬은 따로 안 한다. 대부분 next URL 은 그대로 재사용되므로 충분.
  return a === b
}

/** paginate 가 호출자에게 요구하는 fetch 함수 시그니처. retry 통합 시에도 동일 인터페이스 유지. */
type FetchFn = (url: string, init: RequestInit) => Promise<Response>

/**
 * fetch 응답에서 본문(JSON 또는 text) 과 itemsPath 추출 결과를 함께 반환한다.
 * itemsPath 가 없거나 itemsPath 가 array 가 아니면 빈 배열을 items 로 간주.
 */
async function readBodyAndItems(
  response: Response,
  itemsPath: string | undefined,
): Promise<{body: unknown; items: unknown[]}> {
  const contentType = response.headers.get('content-type') ?? ''
  let body: unknown
  if (isJsonContentType(contentType)) {
    const text = await response.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  } else {
    body = await response.text()
  }

  let extracted: unknown
  if (itemsPath === undefined) {
    extracted = body
  } else {
    extracted = getByPath(body, itemsPath)
  }
  const items = Array.isArray(extracted) ? extracted : []
  return {body, items}
}

export interface PaginateRequest {
  url: string
  init: RequestInit
}

/**
 * pagination 설정에 따라 여러 페이지를 순차 호출하며 items 를 누적해 반환한다.
 *
 *   - cursor: 첫 요청 응답에서 nextPath 추출 → 다음 요청 query 의 pageParam 으로 전달.
 *             nextPath 가 falsy 면 종료. (null, "", undefined 모두 종료 신호.)
 *   - offset: page 또는 offset 을 1 부터 1씩 증가. items 가 빈 배열이면 종료.
 *             첫 페이지는 1 (또는 perPage 가 있으면 sizeParam 도 함께 전송).
 *   - link-header: Link: <next>; rel="next" 헤더가 있으면 그 URL 로 이어서 요청.
 *                  헤더에 rel="next" 가 없으면 종료.
 *
 * maxPages 도달 시 warning 로그 후 종료.
 * 실패한 응답(2xx 아님) 은 즉시 에러를 던진다 — 호출자가 ExecutionResult 로 변환.
 */
export async function paginate(
  baseRequest: PaginateRequest,
  pagConfig: NormalizedPaginationConfig,
  fetchFn: FetchFn,
): Promise<unknown[]> {
  const accumulated: unknown[] = []
  let pageCount = 0

  const {style, pageParam, sizeParam, itemsPath, nextPath, maxPages, perPage} = pagConfig

  // 첫 요청 URL — perPage 가 있으면 sizeParam 자동 주입.
  let nextUrl: string | null = baseRequest.url
  if (perPage !== undefined && sizeParam) {
    nextUrl = setQueryParam(nextUrl, sizeParam, String(perPage))
  }

  // offset 스타일은 pageParam 으로 1 부터 시작 (만약 호출자가 직접 query 에 넣지 않았다면).
  // 호출자가 이미 pageParam 을 query 에 박아 두었으면(예: --page 5) 그 값을 시작점으로 신뢰한다.
  let offsetCursor: number = 1
  if (style === 'offset' && pageParam) {
    const [, q = ''] = nextUrl.split('?', 2) as [string, string?]
    const existing = new URLSearchParams(q).get(pageParam)
    if (existing !== null && Number.isFinite(Number(existing))) {
      offsetCursor = Number(existing)
    } else {
      nextUrl = setQueryParam(nextUrl, pageParam, String(offsetCursor))
    }
  }

  let lastUrl: string | null = null

  while (nextUrl !== null) {
    if (pageCount >= maxPages) {
      logger.warn(`pagination: reached maxPages=${maxPages} — stopping. (some items may be omitted)`)
      break
    }

    // 무한 루프 가드: 직전 URL 과 완전히 동일하면 중단 (next cursor 가 갱신되지 않은 경우).
    if (lastUrl !== null && sameEndpoint(lastUrl, nextUrl)) {
      logger.warn('pagination: next URL did not change between pages — stopping to avoid infinite loop.')
      break
    }
    lastUrl = nextUrl

    const response = await fetchFn(nextUrl, baseRequest.init)
    if (!response.ok) {
      throw new Error(`pagination: HTTP ${response.status} ${response.statusText} on page ${pageCount + 1}`)
    }
    pageCount++

    if (style === 'link-header') {
      const {items} = await readBodyAndItems(response, itemsPath)
      accumulated.push(...items)
      const linkHeader = response.headers.get('link') ?? response.headers.get('Link')
      const nextFromLink = parseLinkHeaderNext(linkHeader)
      nextUrl = nextFromLink
      continue
    }

    if (style === 'cursor') {
      const {body, items} = await readBodyAndItems(response, itemsPath)
      accumulated.push(...items)
      const next = nextPath ? getByPath(body, nextPath) : undefined
      if (next === null || next === undefined || next === '' || next === false) {
        nextUrl = null
      } else {
        // pageParam 은 normalize 단계에서 cursor 스타일에 대해 필수임이 보장됨.
        nextUrl = setQueryParam(baseRequest.url, pageParam!, String(next))
        // perPage 가 있으면 매 요청마다 sizeParam 도 유지.
        if (perPage !== undefined && sizeParam) {
          nextUrl = setQueryParam(nextUrl, sizeParam, String(perPage))
        }
      }
      continue
    }

    // offset 스타일
    const {items} = await readBodyAndItems(response, itemsPath)
    if (items.length === 0) {
      // 빈 페이지 → 종료. (현재 페이지의 items 는 0개이므로 누적 변화 없음.)
      nextUrl = null
      continue
    }
    accumulated.push(...items)
    offsetCursor++
    nextUrl = setQueryParam(baseRequest.url, pageParam!, String(offsetCursor))
    if (perPage !== undefined && sizeParam) {
      nextUrl = setQueryParam(nextUrl, sizeParam, String(perPage))
    }
  }

  return accumulated
}

/**
 * Content-Type 헤더가 JSON 계열인지 판별.
 * 매칭: application/json, application/problem+json, application/ld+json, text/json 등.
 * 오탐 제외: foo/json-bar, jsonstuff 같은 임의 문자열.
 */
function isJsonContentType(ct: string): boolean {
  return /^\s*(?:application|text)\/(?:[\w.+-]+\+)?json(?:\s*;.*)?$/i.test(ct)
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal retry config. The manifest 의 `provider.config.retry` 필드를
 * 그대로 받지만(현재 schema.ts 가 additionalProperties: true 라 typed 가
 * 아님), 여기서 NormalizedRetryConfig 로 정규화한 뒤 사용한다.
 *
 * 사용자가 어떤 필드도 지정하지 않으면 기본 동작은 "재시도 안 함"이다
 * (attempts=1) — 기존 동작과 100% 호환.
 */
export interface RawRetryConfig {
  attempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  retryOn?: number[]
  respectRetryAfter?: boolean
  jitter?: 'full' | 'equal' | 'none'
  /**
   * - true:  항상 재시도 시도 (POST 포함)
   * - false: 재시도 안 함 (네트워크 에러도)
   * - 'auto'(기본): GET/HEAD/PUT/DELETE 만 재시도
   */
  idempotent?: boolean | 'auto'
}

interface NormalizedRetryConfig {
  attempts: number
  initialDelayMs: number
  maxDelayMs: number
  retryOn: ReadonlySet<number>
  respectRetryAfter: boolean
  jitter: 'full' | 'equal' | 'none'
  idempotent: boolean | 'auto'
}

const DEFAULT_RETRY_ON = [429, 500, 502, 503, 504]
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE'])

/**
 * Manifest 의 retry 섹션(any) 을 안전한 internal 타입으로 정규화.
 * 잘못된 값/누락된 필드는 합리적 기본값으로 보정. 음수는 0으로 clamp.
 */
export function normalizeRetryConfig(raw: unknown): NormalizedRetryConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<RawRetryConfig>

  const attempts = Math.max(1, Math.floor(typeof r.attempts === 'number' ? r.attempts : 1))
  const initialDelayMs = Math.max(0, Math.floor(typeof r.initialDelayMs === 'number' ? r.initialDelayMs : 200))
  const maxDelayMs = Math.max(initialDelayMs, Math.floor(typeof r.maxDelayMs === 'number' ? r.maxDelayMs : 5000))
  const retryOnArr = Array.isArray(r.retryOn) && r.retryOn.length > 0
    ? r.retryOn.filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
    : DEFAULT_RETRY_ON
  const retryOn = new Set<number>(retryOnArr)
  const respectRetryAfter = r.respectRetryAfter !== false
  const jitter: 'full' | 'equal' | 'none' =
    r.jitter === 'none' || r.jitter === 'equal' || r.jitter === 'full' ? r.jitter : 'full'
  const idempotent: boolean | 'auto' =
    r.idempotent === true || r.idempotent === false || r.idempotent === 'auto'
      ? r.idempotent
      : 'auto'

  return {attempts, initialDelayMs, maxDelayMs, retryOn, respectRetryAfter, jitter, idempotent}
}

/** retryOn 또는 idempotent 정책에 따라 주어진 메서드가 재시도 대상인지 결정한다. */
export function isMethodRetryable(method: string, idempotent: boolean | 'auto'): boolean {
  if (idempotent === false) return false
  if (idempotent === true) return true
  return IDEMPOTENT_METHODS.has(method.toUpperCase())
}

/**
 * Exponential backoff + jitter.
 *   delay = min(maxDelayMs, initialDelayMs * 2^(attempt-1))
 *   - full:  random(0, delay)
 *   - equal: delay/2 + random(0, delay/2)
 *   - none:  delay 그대로 (deterministic)
 */
export function computeBackoffMs(
  attempt: number,
  cfg: Pick<NormalizedRetryConfig, 'initialDelayMs' | 'maxDelayMs' | 'jitter'>,
  rng: () => number = Math.random,
): number {
  const exp = cfg.initialDelayMs * Math.pow(2, Math.max(0, attempt - 1))
  const base = Math.min(cfg.maxDelayMs, exp)
  if (cfg.jitter === 'none') return base
  if (cfg.jitter === 'equal') return base / 2 + rng() * (base / 2)
  // full
  return rng() * base
}

/**
 * Retry-After 헤더 파싱.
 *   - 정수(seconds) → ms
 *   - HTTP-date     → now 와의 차이(ms, 음수면 0)
 *   - 파싱 실패     → null
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  // 정수 초 (RFC 7231: delay-seconds)
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now)
  }
  return null
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0) {
      resolve()
      return
    }
    setTimeout(resolve, ms)
  })

/**
 * fetch 를 retry 정책으로 감싼다.
 *
 * 발동 조건:
 *   - response.status ∈ retryOn
 *   - fetch 자체 실패 (네트워크 에러 / AbortError 포함)
 *   - 단, 메서드가 idempotent 정책에 부합하지 않으면 재시도하지 않는다.
 *
 * 401 은 절대 retry 하지 않는다. (auth-handlers 의 JWT refresh 로직과 충돌 회피)
 *
 * 시도 사이 delay = Retry-After 헤더 우선(있으면) 또는 exponential backoff + jitter,
 * 둘 다 maxDelayMs 로 cap.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retry: NormalizedRetryConfig,
  method: string,
  hooks: {
    sleep?: (ms: number) => Promise<void>
    rng?: () => number
    fetchImpl?: typeof fetch
  } = {},
): Promise<Response> {
  const doFetch = hooks.fetchImpl ?? fetch
  const doSleep = hooks.sleep ?? sleep
  const rng = hooks.rng ?? Math.random
  const allowRetry = isMethodRetryable(method, retry.idempotent) && retry.attempts > 1

  let lastError: unknown
  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    try {
      const response = await doFetch(url, init)
      // 401 은 retry 정책 미적용 (auth-handlers 가 처리).
      if (response.status === 401) return response
      // 성공 또는 retryOn 에 없는 status → 그대로 반환
      if (!retry.retryOn.has(response.status)) return response
      // retryOn 매칭 → idempotent 가 아니거나 마지막 시도면 그대로 반환
      if (!allowRetry || attempt === retry.attempts) return response
      // 재시도 대기
      const retryAfterMs = retry.respectRetryAfter
        ? parseRetryAfter(response.headers.get('Retry-After'))
        : null
      const baseDelay = retryAfterMs ?? computeBackoffMs(attempt, retry, rng)
      const delay = Math.min(retry.maxDelayMs, Math.max(0, baseDelay))
      // 응답 본문이 stream 이라면 release (caller 가 buffer 안 했을 수 있으므로).
      try {
        if (typeof response.body?.cancel === 'function') {
          await response.body.cancel()
        }
      } catch {
        /* noop */
      }
      await doSleep(delay)
      continue
    } catch (err) {
      lastError = err
      if (!allowRetry || attempt === retry.attempts) {
        throw err
      }
      const delay = Math.min(retry.maxDelayMs, computeBackoffMs(attempt, retry, rng))
      await doSleep(delay)
      continue
    }
  }
  // 이론상 도달 불가 (위 루프에서 항상 return 또는 throw).
  throw lastError ?? new Error('fetchWithRetry: exhausted without response')
}

export class HTTPProvider implements IProvider {
  readonly type = 'http' as const
  private config: HttpProviderConfig
  private namespace: string
  private authManager: AuthManager
  private dispatcherCache = new Map<string, unknown>()
  private proxyConfig = readProxyEnv()

  constructor(config: HttpProviderConfig, namespace: string, authManager?: AuthManager) {
    this.config = config
    this.namespace = namespace
    this.authManager = authManager ?? new AuthManager(new EnvCredentialStore())
  }

  /**
   * URL 의 host 기준으로 dispatcher 를 캐싱한다 (TLS handshake 재사용).
   * proxy 가 설정되지 않은 host 는 cache 에 undefined 저장.
   */
  private async getDispatcher(targetUrl: string | URL | Request): Promise<unknown | undefined> {
    const urlStr = typeof targetUrl === 'string' ? targetUrl : targetUrl instanceof URL ? targetUrl.toString() : targetUrl.url
    let host: string
    try {
      host = new URL(urlStr).host
    } catch {
      return undefined
    }
    if (this.dispatcherCache.has(host)) return this.dispatcherCache.get(host)
    // 우선순위: proxy 가 적용 가능하면 proxy dispatcher.
    // proxy 가 NO_PROXY 등으로 무시되거나 미설정이면 mTLS 옵션을 확인 → tls dispatcher.
    let dispatcher = await createDispatcher(urlStr, this.proxyConfig)
    if (!dispatcher) {
      const tlsCfg = readTlsConfig(this.config.tls)
      if (tlsCfg) {
        dispatcher = await createTlsDispatcher(tlsCfg)
      }
    }
    this.dispatcherCache.set(host, dispatcher ?? undefined)
    return dispatcher ?? undefined
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

            // refresh fetch 도 proxy / mTLS dispatcher 적용 (enterprise / private PKI / corporate proxy 환경에서 동작 보장).
            const refreshUrl = resolveEndpointUrl(this.config.baseUrl, auth.tokenEndpoint)
            const refreshDispatcher = await this.getDispatcher(refreshUrl)
            const refreshInit: RequestInit & {dispatcher?: unknown} = {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body: params.toString(),
              signal: AbortSignal.timeout(this.config.timeout ?? 10000),
            }
            if (refreshDispatcher) refreshInit.dispatcher = refreshDispatcher
            const resp = await fetch(refreshUrl, refreshInit)
            if (resp.ok) {
              const refreshed = await resp.json() as {
                access_token: string; refresh_token?: string; expires_in?: number;
              }
              accessToken = refreshed.access_token
              // RFC 6749 best practice — refresh_token rotation:
              // 응답에 새 refresh_token 이 있고 비어있지 않으면 교체, 그 외에는 기존 값 유지.
              // 빈 문자열은 보수적으로 기존 값 유지 (쓸 수 없는 값으로 교체되어 다음 refresh 가 실패하는 것 방지).
              const newRefresh =
                typeof refreshed.refresh_token === 'string' && refreshed.refresh_token.trim().length > 0
                  ? refreshed.refresh_token
                  : stored.refresh_token
              const rotated = newRefresh !== stored.refresh_token
              tokens[serviceName] = {
                access_token: refreshed.access_token,
                refresh_token: newRefresh,
                expires_in: refreshed.expires_in ?? stored.expires_in,
                savedAt: new Date().toISOString(),
                authType: 'device-code',
              }
              const dir = tokenFile.substring(0, tokenFile.lastIndexOf('/'))
              await mkdir(dir, {recursive: true})
              await writeFile(tokenFile, JSON.stringify(tokens, null, 2))
              logger.debug(
                `[device-code] ${this.namespace}: 토큰 자동 갱신 성공${rotated ? ' (refresh_token rotated)' : ''}`,
              )
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

    // 6. Execute fetch — retry + pagination 통합
    //    retry: 5xx/429/네트워크 에러 + idempotent 메서드일 때 자동 재시도.
    //    pagination: provider.config.pagination 설정 + flags.all=true 일 때 누적.
    const retryConfig = normalizeRetryConfig(this.config.retry)
    // 명령 단위 timeout 이 명시되면 그것을 우선 사용 (cluster manager 의 cluster get / health 처럼
    // 일부 endpoint 가 더 오래 걸리는 경우, 다른 fast endpoint 의 timeout 을 짧게 유지하면서 override 가능).
    const cmdTimeout = (httpConfig as {timeout?: number}).timeout
    const timeoutMs = cmdTimeout ?? this.config.timeout ?? 30000

    // init 에는 signal 을 넣지 않는다. AbortSignal 은 한 번 abort 되면 재사용이
    // 불가능하므로, fetchImpl wrapper 에서 매 시도마다 fresh signal 을 주입한다.
    const init: RequestInit = {
      method: httpConfig.method,
      headers: finalHeaders,
      body: body ? JSON.stringify(body) : undefined,
    }

    const fetchWithRetryFn = (u: string, i: RequestInit): Promise<Response> =>
      fetchWithRetry(u, i, retryConfig, httpConfig.method, {
        fetchImpl: async (uu, ii) => {
          const dispatcher = await this.getDispatcher(uu)
          const init: RequestInit & {dispatcher?: unknown} = {
            ...ii,
            signal: AbortSignal.timeout(timeoutMs),
          }
          if (dispatcher) init.dispatcher = dispatcher
          return fetch(uu, init)
        },
      })

    const wantsAll = input.flags.all === true
    if (this.config.pagination !== undefined && wantsAll) {
      let pagConfig: NormalizedPaginationConfig
      try {
        pagConfig = normalizePaginationConfig(this.config.pagination)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          success: false,
          data: null,
          exitCode: 1,
          duration: performance.now() - startTime,
          error: {code: 'HTTP_PAGINATION_CONFIG_ERROR', message},
        }
      }
      try {
        const items = await paginate({url, init}, pagConfig, fetchWithRetryFn)
        return {
          success: true,
          data: items,
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
          error: {code: 'HTTP_PAGINATION_ERROR', message},
        }
      }
    }

    try {
      const response = await fetchWithRetryFn(url, init)

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

      const dispatcher = await this.getDispatcher(this.config.baseUrl)
      const init: RequestInit & {dispatcher?: unknown} = {
        method: 'GET',
        headers: authHeaders,
        signal: AbortSignal.timeout(5000),
      }
      if (dispatcher) init.dispatcher = dispatcher
      const response = await fetch(this.config.baseUrl, init)

      // status<500 은 "네트워크로는 도달 가능". 4xx 는 endpoint 부재/auth 누락 등 client side 문제일 뿐
      // 백엔드 서비스 자체는 살아있음을 의미하므로 healthy=true 로 분류한다.
      // (이전에는 response.ok 만 healthy 로 봐서, baseUrl 의 root path 가 404 인 정상 서비스가 'error' 로 나타났다.)
      const reachable = response.status < 500
      const authProblem = response.status === 401 || response.status === 403
      const message = response.ok
        ? `${this.config.baseUrl} is reachable`
        : authProblem
        ? `${this.config.baseUrl} reachable but authentication required (HTTP ${response.status})`
        : reachable
        ? `${this.config.baseUrl} reachable (HTTP ${response.status} on root path)`
        : `${this.config.baseUrl} returned HTTP ${response.status}`

      return {
        healthy: reachable,
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

