import type {PluginManifest} from '../core/types.js'
import {ManifestParseError} from './parser.js'

const STANDARD_FLAGS = new Set([
  'json', 'debug', 'quiet', 'no-color', 'format', 'help',
])

const SENSITIVE_FLAG_PATTERNS = /^(password|secret|token|api[_-]?key|credential|auth[_-]?token)$/i

export interface ValidationWarning {
  type: 'sensitive-flag'
  message: string
}

export function validateManifest(manifest: PluginManifest, source = '<string>'): ValidationWarning[] {
  const {provider, commands} = manifest
  const commandIds = new Set<string>()
  const warnings: ValidationWarning[] = []

  for (const cmd of commands) {
    // 중복 command ID 검사
    if (commandIds.has(cmd.id)) {
      throw new ManifestParseError(
        `중복된 command ID: "${cmd.id}" (${source}). 각 command의 id는 고유해야 합니다.`,
      )
    }
    commandIds.add(cmd.id)

    // provider type과 command config 일치 검사
    validateCommandProviderMatch(cmd, provider.type, source)

    // 표준 플래그 충돌 검사
    for (const flag of cmd.flags ?? []) {
      if (STANDARD_FLAGS.has(flag.name)) {
        throw new ManifestParseError(
          `플래그 "--${flag.name}"은 표준 플래그와 충돌합니다 (command: ${cmd.id}, ${source}). ` +
          `다른 이름을 사용해주세요.`,
        )
      }

      if (flag.char && ['h', 'q'].includes(flag.char)) {
        throw new ManifestParseError(
          `플래그 단축키 "-${flag.char}"는 표준 플래그와 충돌합니다 (command: ${cmd.id}, ${source}). ` +
          `다른 단축키를 사용해주세요.`,
        )
      }

      // 시크릿 플래그 경고: 플래그로 비밀 값을 직접 받으면 ps/history에 노출됨
      if (SENSITIVE_FLAG_PATTERNS.test(flag.name)) {
        warnings.push({
          type: 'sensitive-flag',
          message:
            `경고: 플래그 "--${flag.name}" (command: ${cmd.id}, ${source})은 민감 정보를 포함할 수 있습니다. ` +
            `플래그로 시크릿을 받으면 프로세스 목록(ps)과 셸 히스토리에 노출됩니다. ` +
            `환경변수 참조(env), 파일(file), 또는 stdin 입력을 권장합니다.`,
        })
      }
    }
  }

  return warnings
}

function validateCommandProviderMatch(
  cmd: PluginManifest['commands'][number],
  providerType: string,
  source: string,
): void {
  const configMap: Record<string, string> = {
    http: 'http',
    cli: 'cli',
    python: 'python',
    js: 'js',
  }

  const expectedKey = configMap[providerType]
  if (!expectedKey) return

  if (!cmd[expectedKey as keyof typeof cmd]) {
    throw new ManifestParseError(
      `Command "${cmd.id}"에 "${expectedKey}" 설정이 필요합니다 (provider type: ${providerType}, ${source}). ` +
      `"${expectedKey}" 섹션을 추가해주세요.`,
    )
  }
}
