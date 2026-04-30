import type {PluginManifest} from '../core/types.js'
import {ManifestParseError} from './parser.js'

/** BaseCommand 가 모든 명령에 자동 주입하는 글로벌 플래그 — manifest 가 가로챌 수 없다. */
const STANDARD_FLAGS = new Set([
  'json', 'debug', 'quiet', 'no-color', 'format', 'help',
])

/** 시크릿일 가능성이 높은 플래그 이름 패턴. 일치 시 ps/history 노출 경고를 발생시킨다. */
const SENSITIVE_FLAG_PATTERNS = /^(password|secret|token|api[_-]?key|credential|auth[_-]?token)$/i

/**
 * 비치명적 검증 경고. throw 대신 결과에 누적되어 호출자가 사용자에게 표시한다.
 */
export interface ValidationWarning {
  type: 'sensitive-flag'
  message: string
}

/**
 * Manifest 의 semantic 검증을 수행한다 (AJV 스키마 검증 이후 단계).
 *
 * 다음 항목을 검사한다:
 * - 동일 manifest 내 command ID 중복 → throw
 * - provider type 과 command 의 config 섹션 일치 → throw
 * - 표준 플래그 이름/단축키와 충돌 → throw
 * - 시크릿 의심 플래그 이름 → 경고 누적
 * @param manifest - 스키마 검증을 통과한 PluginManifest
 * @param source - 에러 메시지 출처 라벨 (파일명 등). 기본값 `<string>`
 * @returns 비치명적 경고 배열 (없으면 빈 배열)
 * @throws {ManifestParseError} 치명적 검증 실패 시
 */
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

/**
 * provider type 에 대응하는 command config 섹션이 존재하는지 확인한다.
 * 예: provider.type === 'http' 이면 command 에 `http` 섹션이 필수.
 */
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
