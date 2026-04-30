import {readFile} from 'node:fs/promises'
import {parse as parseYaml} from 'yaml'
import Ajv, {type ErrorObject} from 'ajv'
import {manifestSchema} from './schema.js'
import {validateManifest, type ValidationWarning} from './validator.js'
import type {PluginManifest} from '../core/types.js'

const AjvConstructor = (Ajv as any).default || Ajv
const ajv = new AjvConstructor({allErrors: true, verbose: true})
const validate = ajv.compile(manifestSchema)

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
  return parseManifestString(content, filePath)
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

  const valid = validate(raw)
  if (!valid) {
    const errors = (validate.errors as ErrorObject[] ?? [])
      .map((e: ErrorObject) => `  ${e.instancePath || '/'}: ${e.message}`)
      .join('\n')
    throw new ManifestParseError(`Manifest 스키마 검증 실패 (${source}):\n${errors}`)
  }

  const manifest = raw as PluginManifest
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
