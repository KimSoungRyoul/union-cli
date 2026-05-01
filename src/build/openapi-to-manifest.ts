/**
 * OpenAPI 3.x spec → union-cli manifest YAML 변환기.
 *
 * 입력: OpenAPI 3.0 / 3.1 JSON 객체 (이미 파싱된 상태)
 * 출력: tag 별 manifest 객체 배열 (호출자가 stringify 해서 파일에 기록)
 *
 * 매핑 룰 (v1):
 *   - tags        → 1 tag = 1 manifest = 1 namespace (split 모드, default)
 *   - operationId → command id 추출 (heuristic)
 *   - path / method → http.path / http.method
 *   - path param  → args (required, description)
 *   - query param → flags with httpMap=query
 *   - body schema → flags with httpMap=body (top-level properties 를 flatten)
 *   - bodySchema 의 nested object/array → httpBodyType=json (또는 array/number-array)
 *   - enum, default, required, description 모두 보존
 *
 * 한계 (v1 은 안 함):
 *   - oneOf / anyOf / discriminator polymorphism
 *   - $ref 재귀 (단순 1-단계만 풀음)
 *   - file upload (multipart) — 무시 + 경고
 *   - security schemes 의 OAuth2 flow
 *   - response schema 분석
 */

import type {PluginManifest, ManifestCommand, FlagSpec, ArgSpec} from '../core/types.js'

// ── OpenAPI 타입 (최소한) ──

interface OpenApiSpec {
  openapi: string
  info?: {title?: string; description?: string; version?: string}
  servers?: Array<{url: string; description?: string}>
  paths?: Record<string, OpenApiPathItem>
  components?: {schemas?: Record<string, OpenApiSchema>}
  tags?: Array<{name: string; description?: string}>
}

interface OpenApiPathItem {
  get?: OpenApiOperation
  post?: OpenApiOperation
  put?: OpenApiOperation
  patch?: OpenApiOperation
  delete?: OpenApiOperation
  parameters?: OpenApiParameter[]
}

interface OpenApiOperation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, unknown>
}

interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: OpenApiSchema
}

interface OpenApiRequestBody {
  required?: boolean
  content?: Record<string, {schema?: OpenApiSchema}>
}

interface OpenApiSchema {
  $ref?: string
  type?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'
  format?: string
  enum?: unknown[]
  default?: unknown
  description?: string
  title?: string
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  items?: OpenApiSchema
  anyOf?: OpenApiSchema[]
  oneOf?: OpenApiSchema[]
  allOf?: OpenApiSchema[]
  maxLength?: number
  minLength?: number
  maximum?: number
  minimum?: number
  pattern?: string
}

// ── 변환 옵션 ──

export interface ConvertOptions {
  /** manifest name 의 prefix. 미지정 시 spec.info.title 또는 'api'. */
  namePrefix?: string
  /** 모든 manifest 의 baseUrl 에 들어갈 값 (보통 ${ENV:-default} 형식). 미지정 시 servers[0].url */
  baseUrl?: string
  /** true 면 tag 별 split (default), false 면 단일 manifest (id=tag:action 형식) */
  split?: boolean
  /** auth.type 기본 (none/bearer/jwt/api-key/...). 미지정 시 'none'. */
  authType?: string
}

export interface ConvertResult {
  /** 결과 manifest 들. split=false 면 1개. */
  manifests: PluginManifest[]
  /** 변환 중 노출된 경고/스킵 메시지. */
  warnings: string[]
}

// ── 유틸 ──

function resolveRef(ref: string, spec: OpenApiSpec): OpenApiSchema | null {
  // ref: '#/components/schemas/Foo'
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  let cur: unknown = spec
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[p]
  }
  return (cur as OpenApiSchema) ?? null
}

function deref(schema: OpenApiSchema | undefined, spec: OpenApiSpec, depth = 0): OpenApiSchema | undefined {
  if (!schema) return undefined
  if (depth > 5) return schema
  if (schema.$ref) {
    const target = resolveRef(schema.$ref, spec)
    if (target) return deref(target, spec, depth + 1)
  }
  return schema
}

/** schema 의 anyOf/oneOf 에서 nullable 패턴 ([{type:X}, {type:'null'}]) 인 경우 base 반환 */
function unwrapNullable(schema: OpenApiSchema): {schema: OpenApiSchema; nullable: boolean} {
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    // OpenAPI 3.1 의 nullable 표현은 type 에 'null' 도 들어올 수 있음 → string compare
    const nonNull = schema.anyOf.filter((s) => (s.type as unknown as string) !== 'null')
    const hasNull = schema.anyOf.length !== nonNull.length
    if (nonNull.length === 1) return {schema: nonNull[0], nullable: hasNull}
  }
  return {schema, nullable: false}
}

function toKebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

const ID_PATTERN = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$/

function sanitizeId(s: string): string {
  // a-z, 0-9, hyphen 만 허용. 시작은 a-z. 첫 segment 가 숫자로 시작하면 'x' prefix.
  let out = s.toLowerCase().replace(/[^a-z0-9:-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!out || /^[0-9]/.test(out)) out = 'op-' + out
  return out
}

function sanitizeNamespace(s: string): string {
  let out = s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!out || /^[0-9]/.test(out)) out = 'ns-' + out
  return out
}

/** path + method → 합리적인 command id heuristic */
function deriveCommandId(method: string, path: string, _operationId: string | undefined): string {
  const m = method.toUpperCase()
  const allSegments = path.split('/').filter((s) => s.length > 0)
  if (allSegments.length === 0) return sanitizeId(methodToVerb(m))

  const last = allSegments[allSegments.length - 1]
  const prev = allSegments.length >= 2 ? allSegments[allSegments.length - 2] : null
  const isParam = (s: string): boolean => /^\{[^}]+\}$/.test(s)

  // /a/{id} → method default (get/update/delete) — collection item
  if (isParam(last)) return sanitizeId(methodToVerb(m))

  // /a/{id}/health (sub-resource action) — 부모가 path param 이면:
  //   GET 은 액션 이름 그대로 ('health', 'users')
  //   다른 method 는 method-action 으로 prefix → collision 방지 (POST /admin/{id}/users → 'create-users')
  if (prev && isParam(prev)) {
    if (m === 'GET') return sanitizeId(last)
    return sanitizeId(`${methodToVerb(m)}-${last}`)
  }

  // /api/v1/<collection> → list (GET) / create (POST)
  if (m === 'GET') return 'list'
  return sanitizeId(methodToVerb(m))
}

function methodToVerb(m: string): string {
  switch (m) {
    case 'GET':
      return 'get'
    case 'POST':
      return 'create'
    case 'PUT':
    case 'PATCH':
      return 'update'
    case 'DELETE':
      return 'delete'
    default:
      return m.toLowerCase()
  }
}

/** schema → flag 의 type / httpBodyType / options / default 등을 추정 */
function schemaToFlag(
  name: string,
  schemaRaw: OpenApiSchema | undefined,
  required: boolean,
  spec: OpenApiSpec,
  httpMap: 'query' | 'body' | 'header',
): FlagSpec {
  const schema = schemaRaw ? deref(schemaRaw, spec) : undefined
  const {schema: sch} = schema ? unwrapNullable(schema) : {schema: undefined as OpenApiSchema | undefined}

  const flagName = toKebab(name)
  const httpName = name !== flagName ? name : undefined
  const flag: FlagSpec = {name: flagName, httpMap}
  if (httpName) flag.httpName = httpName
  if (required) flag.required = true
  if (sch?.description) flag.description = sch.description.replace(/\s+/g, ' ').trim()

  if (!sch) return flag

  // type 매핑
  const t = sch.type
  if (t === 'integer' || t === 'number') {
    flag.type = 'number'
    if (sch.default !== undefined && (typeof sch.default === 'number' || typeof sch.default === 'string')) {
      flag.default = typeof sch.default === 'number' ? sch.default : Number(sch.default)
    }
  } else if (t === 'boolean') {
    flag.type = 'boolean'
  } else if (t === 'array') {
    if (httpMap === 'body') {
      const items = sch.items ? deref(sch.items, spec) : undefined
      const itemType = items?.type
      flag.httpBodyType = itemType === 'integer' || itemType === 'number' ? 'number-array' : 'array'
    } else {
      // query 의 array 는 repeat / csv 를 직접 지정해야 하므로 일단 string 으로
      flag.type = 'string'
    }
  } else if (t === 'object') {
    if (httpMap === 'body') flag.httpBodyType = 'json'
    flag.type = 'string'
  } else {
    // string / format 등
    flag.type = 'string'
    if (sch.enum && Array.isArray(sch.enum) && sch.enum.length > 0) {
      flag.options = sch.enum.map((v) => String(v))
    }
    if (sch.default !== undefined && typeof sch.default === 'string') {
      flag.default = sch.default
    }
  }

  // string default — 위에서 안 처리된 경우
  if (flag.default === undefined && sch.default !== undefined) {
    if (typeof sch.default === 'string' || typeof sch.default === 'number' || typeof sch.default === 'boolean') {
      flag.default = sch.default
    }
  }

  return flag
}

function deriveTitle(op: OpenApiOperation): string {
  const raw = op.summary || op.description || op.operationId || ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function isDangerous(method: string): boolean {
  return method.toUpperCase() === 'DELETE'
}

// ── 메인 변환 ──

export function convertOpenApiToManifests(
  spec: OpenApiSpec,
  options: ConvertOptions = {},
): ConvertResult {
  const warnings: string[] = []
  const split = options.split !== false // default true
  const namePrefix = options.namePrefix || sanitizeNamespace(spec.info?.title ?? 'api')
  const baseUrl =
    options.baseUrl ?? spec.servers?.[0]?.url ?? 'http://localhost:8080'
  const authType = options.authType ?? 'none'

  // tag → operations 그루핑
  const tagOps = new Map<string, Array<{path: string; method: string; op: OpenApiOperation; pathItem: OpenApiPathItem}>>()
  const allOps: Array<{path: string; method: string; op: OpenApiOperation; pathItem: OpenApiPathItem}> = []

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = pathItem[method]
      if (!op) continue
      const tags = op.tags && op.tags.length > 0 ? op.tags : ['default']
      for (const tag of tags) {
        const key = sanitizeNamespace(tag)
        if (!tagOps.has(key)) tagOps.set(key, [])
        tagOps.get(key)!.push({path, method, op, pathItem})
      }
      allOps.push({path, method, op, pathItem})
    }
  }

  if (split) {
    const manifests: PluginManifest[] = []
    for (const [tag, ops] of tagOps) {
      const m = buildManifest(tag, ops, spec, namePrefix, baseUrl, authType, false, warnings)
      manifests.push(m)
    }
    return {manifests, warnings}
  }

  // single manifest, namespace 는 namePrefix
  const ns = sanitizeNamespace(namePrefix)
  const m = buildManifest(ns, allOps, spec, namePrefix, baseUrl, authType, true, warnings)
  return {manifests: [m], warnings}
}

function buildManifest(
  namespace: string,
  ops: Array<{path: string; method: string; op: OpenApiOperation; pathItem: OpenApiPathItem}>,
  spec: OpenApiSpec,
  namePrefix: string,
  baseUrl: string,
  authType: string,
  prefixIdWithTag: boolean,
  warnings: string[],
): PluginManifest {
  const commands: ManifestCommand[] = []
  const usedIds = new Set<string>()

  for (const {path, method, op, pathItem} of ops) {
    let id = deriveCommandId(method, path, op.operationId)
    if (prefixIdWithTag) {
      const tag = (op.tags && op.tags[0]) ?? 'default'
      id = `${sanitizeNamespace(tag)}:${id}`
    }
    // collision 방지
    let final = id
    let i = 2
    while (usedIds.has(final)) {
      final = `${id}-${i}`
      i++
    }
    usedIds.add(final)

    // path/query/header parameters (path-item level + operation level)
    const allParams: OpenApiParameter[] = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])]
    const args: ArgSpec[] = []
    const flags: FlagSpec[] = []

    for (const param of allParams) {
      const paramDeref = param.schema ? {param, schema: deref(param.schema, spec)} : {param, schema: undefined}
      if (param.in === 'path') {
        args.push({
          name: param.name,
          required: param.required ?? true,
          ...(param.description ? {description: param.description.replace(/\s+/g, ' ').trim()} : {}),
        })
      } else if (param.in === 'query' || param.in === 'header') {
        flags.push(
          schemaToFlag(
            param.name,
            paramDeref.schema,
            param.required ?? false,
            spec,
            param.in === 'header' ? 'header' : 'query',
          ),
        )
      } else {
        warnings.push(`[${method.toUpperCase()} ${path}] cookie parameter "${param.name}" 무시 (지원 안 함)`)
      }
    }

    // request body
    const body = op.requestBody
    if (body) {
      const json = body.content?.['application/json']?.schema
      if (json) {
        const bodySchema = deref(json, spec)
        if (bodySchema?.type === 'object' && bodySchema.properties) {
          const required = new Set(bodySchema.required ?? [])
          for (const [propName, propSchema] of Object.entries(bodySchema.properties)) {
            flags.push(schemaToFlag(propName, propSchema, required.has(propName), spec, 'body'))
          }
        } else {
          // simple body — 단일 --body flag 로 raw json
          flags.push({
            name: 'body',
            required: body.required ?? false,
            httpMap: 'body',
            httpBodyType: 'json',
            description: 'request body (JSON)',
          })
        }
      } else {
        const ct = Object.keys(body.content ?? {}).join(', ') || '(none)'
        warnings.push(
          `[${method.toUpperCase()} ${path}] application/json content 없음 (got: ${ct}) — body flag 미생성`,
        )
      }
    }

    const cmd: ManifestCommand = {
      id: ID_PATTERN.test(final) ? final : sanitizeId(final),
      description: deriveTitle(op) || `${method.toUpperCase()} ${path}`,
      http: {
        method: method.toUpperCase(),
        path,
      },
      ...(args.length ? {args} : {}),
      ...(flags.length ? {flags} : {}),
      ...(isDangerous(method) ? {dangerous: true} : {}),
      ...(op.operationId ? {examples: [`# operationId: ${op.operationId}`]} : {}),
    }
    commands.push(cmd)
  }

  // PluginManifest 형태로 반환 — provider config 는 retry/pagination 같은 sane defaults
  const manifest: PluginManifest = {
    name: `${namePrefix}-${namespace}`,
    namespace,
    description:
      spec.tags?.find((t) => sanitizeNamespace(t.name) === namespace)?.description ||
      spec.info?.description ||
      `${namespace} commands generated from OpenAPI`,
    provider: {
      type: 'http',
      config: {
        baseUrl,
        auth: {type: authType as 'none'},
        timeout: 15000,
        retry: {
          attempts: 3,
          retryOn: [429, 500, 502, 503, 504],
          respectRetryAfter: true,
          jitter: 'full',
          idempotent: 'auto',
        },
      } as Record<string, unknown> as never,
    },
    commands,
  }
  return manifest
}
