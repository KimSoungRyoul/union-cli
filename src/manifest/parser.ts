import {readFile} from 'node:fs/promises'
import {parse as parseYaml} from 'yaml'
import Ajv, {type ErrorObject} from 'ajv'
import {manifestSchema} from './schema.js'
import {validateManifest, type ValidationWarning} from './validator.js'
import type {PluginManifest} from '../core/types.js'

const AjvConstructor = (Ajv as any).default || Ajv
const ajv = new AjvConstructor({allErrors: true, verbose: true})
const validate = ajv.compile(manifestSchema)

export interface ParseResult {
  manifest: PluginManifest
  warnings: ValidationWarning[]
}

export async function parseManifestFile(filePath: string): Promise<ParseResult> {
  const content = await readFile(filePath, 'utf-8')
  return parseManifestString(content, filePath)
}

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

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestParseError'
  }
}
