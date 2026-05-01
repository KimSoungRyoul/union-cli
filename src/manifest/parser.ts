import {readFile} from 'node:fs/promises'
import {dirname, isAbsolute, resolve as resolvePath} from 'node:path'
import {parse as parseYaml} from 'yaml'
import Ajv, {type ErrorObject} from 'ajv'
import {manifestSchema} from './schema.js'
import {validateManifest, type ValidationWarning} from './validator.js'
import type {PluginManifest} from '../core/types.js'

// Ajv 가 ESM/CJS dual export 라 환경에 따라 default 위치가 다름. any cast 가 가장 안전.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvConstructor = (Ajv as any).default || Ajv
const ajv = new AjvConstructor({allErrors: true, verbose: true})
const validate = ajv.compile(manifestSchema)

/**
 * Deep-merge two plain objects. Source 의 값이 우선.
 * - object × object: 재귀
 * - array: source 가 통째로 덮어씀 (병합 안 함 — manifest commands 가 실수로 누적되는 걸 방지)
 * - 그 외: source 우선
 */
function deepMerge(target: unknown, source: unknown): unknown {
  if (
    target !== null &&
    typeof target === 'object' &&
    !Array.isArray(target) &&
    source !== null &&
    typeof source === 'object' &&
    !Array.isArray(source)
  ) {
    const out: Record<string, unknown> = {...(target as Record<string, unknown>)}
    for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
      out[k] = k in out ? deepMerge(out[k], v) : v
    }
    return out
  }
  return source !== undefined ? source : target
}

/**
 * raw manifest 객체에 `extends: <path>` 가 있으면 부모 파일을 읽어 deep-merge 한다.
 * cycle detection 으로 무한 재귀 방지.
 */
async function expandExtends(
  raw: Record<string, unknown>,
  baseDir: string | undefined,
  visited: Set<string>,
): Promise<Record<string, unknown>> {
  const extPath = raw.extends
  if (typeof extPath !== 'string' || extPath.trim() === '') return raw

  if (!baseDir) {
    throw new ManifestParseError(
      `extends: 는 파일 경로 기반 manifest 에서만 사용 가능합니다 (parseManifestString 에서는 불가).`,
    )
  }
  const absParent = isAbsolute(extPath) ? extPath : resolvePath(baseDir, extPath)
  if (visited.has(absParent)) {
    throw new ManifestParseError(`extends 사이클 감지: ${[...visited, absParent].join(' → ')}`)
  }
  visited.add(absParent)

  const parentContent = await readFile(absParent, 'utf-8')
  let parentRaw: unknown
  try {
    parentRaw = parseYaml(parentContent)
  } catch (err) {
    throw new ManifestParseError(
      `extends 부모 YAML 파싱 실패 (${absParent}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!parentRaw || typeof parentRaw !== 'object' || Array.isArray(parentRaw)) {
    throw new ManifestParseError(`extends 부모가 객체가 아닙니다 (${absParent})`)
  }

  // 부모도 extends 가능 (재귀)
  const expandedParent = await expandExtends(
    parentRaw as Record<string, unknown>,
    dirname(absParent),
    visited,
  )

  // 자식의 extends 키는 결과에서 제거 (스키마 통과를 위해)
  const {extends: _ignored, ...child} = raw
  return deepMerge(expandedParent, child) as Record<string, unknown>
}

/**
 * 파싱 결과 — 검증 통과한 manifest 와 비치명적 경고 목록.
 *
 * `warnings` 는 throw 가 아닌 경고이므로(예: 시크릿 의심 플래그) 호출자가
 * 사용자에게 표시할 책임이 있다.
 */
export interface ParseResult {
  manifest: PluginManifest
  warnings: ValidationWarning[]
}

/**
 * 파일 경로의 YAML manifest 를 읽고 파싱·검증한다.
 * @param filePath - manifest YAML 파일 절대/상대 경로
 * @returns 검증된 PluginManifest 와 경고 목록
 * @throws {ManifestParseError} YAML 파싱/스키마/구조 검증 실패 시
 */
export async function parseManifestFile(filePath: string): Promise<ParseResult> {
  const content = await readFile(filePath, 'utf-8')
  // extends 처리 — 부모 manifest 파일을 deep-merge 후 child 가 override.
  // raw → expand(extends) → schema validate → semantic validate
  let raw: unknown
  try {
    raw = parseYaml(content)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new ManifestParseError(`YAML 파싱 실패 (${filePath}): ${msg}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestParseError(`Manifest가 객체가 아닙니다 (${filePath})`)
  }
  const visited = new Set<string>([resolvePath(filePath)])
  const expanded = await expandExtends(raw as Record<string, unknown>, dirname(filePath), visited)

  return parseExpandedManifest(expanded, filePath)
}

/**
 * YAML 문자열을 파싱하여 PluginManifest 로 검증한다.
 *
 * 검증 순서: YAML 파싱 → 객체 여부 → AJV 스키마 검증 → semantic 검증(중복 ID,
 * 표준 플래그 충돌, 시크릿 플래그 경고). semantic 단계의 경고만 결과에 포함된다.
 * @param content - YAML 원본 문자열
 * @param source - 에러 메시지에 표시할 출처 라벨 (파일명 등). 기본값 `<string>`
 * @returns 검증된 PluginManifest 와 경고 목록
 * @throws {ManifestParseError} 파싱/검증 단계의 어느 하나라도 실패하면
 */
export function parseManifestString(content: string, source = '<string>'): ParseResult {
  let raw: unknown
  try {
    raw = parseYaml(content)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new ManifestParseError(`YAML 파싱 실패 (${source}): ${msg}`)
  }

  if (!raw || typeof raw !== 'object') {
    throw new ManifestParseError(`Manifest가 객체가 아닙니다 (${source})`)
  }
  // string 입력에서는 extends 사용 불가 (relative path 의 base 가 없음)
  if ((raw as Record<string, unknown>).extends !== undefined) {
    throw new ManifestParseError(
      `extends: 는 parseManifestFile() 에서만 지원됩니다 (parseManifestString 에서는 base path 가 없음, ${source})`,
    )
  }

  return parseExpandedManifest(raw as Record<string, unknown>, source)
}

/** AJV 검증 + semantic 검증 — extends 가 이미 deep-merge 된 후의 final manifest. */
function parseExpandedManifest(raw: Record<string, unknown>, source: string): ParseResult {
  const valid = validate(raw)
  if (!valid) {
    const errors = (validate.errors as ErrorObject[] ?? [])
      .map((e: ErrorObject) => `  ${e.instancePath || '/'}: ${e.message}`)
      .join('\n')
    throw new ManifestParseError(`Manifest 스키마 검증 실패 (${source}):\n${errors}`)
  }

  const manifest = raw as unknown as PluginManifest
  const warnings = validateManifest(manifest, source)

  return {manifest, warnings}
}

/**
 * Manifest 파싱/검증 단계에서 발생한 모든 치명적 에러를 나타내는 전용 에러 타입.
 *
 * 일반 Error 와 구분해 호출자가 catch 후 사용자에게 친화적 메시지를 출력하도록 한다.
 */
export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestParseError'
  }
}
