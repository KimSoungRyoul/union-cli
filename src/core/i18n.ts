/**
 * 단순 i18n catalogue (zero-dep).
 *
 * 사용자 대면 메시지를 ko/en 으로 분기. 실제 wrap (모든 사용자 메시지 → t() 호출 변환)
 * 은 점진적 migration 이라 별도 작업이며, 본 모듈은 catalogue + helper 만 제공.
 *
 * 우선순위 (detectLang):
 *   1. UNION_CLI_LANG (e.g. "ko" | "en")
 *   2. LANG / LC_ALL (e.g. "ko_KR.UTF-8" → "ko")
 *   3. 'en' (default)
 *
 * 사용 예:
 *   import {t} from './i18n.js'
 *   throw new Error(t('auth.login.failed', {namespace, reason}))
 */

export type Lang = 'ko' | 'en'

type MessageMap = Record<string, string>

const messages: Record<Lang, MessageMap> = {
  ko: {
    'auth.login.success': '{namespace} 인증 완료',
    'auth.login.failed': '{namespace} 인증 실패: {reason}',
    'auth.required': '{namespace} namespace에 인증이 필요합니다.',
    'auth.run_login_hint': "'{cli} auth login {namespace}' 를 실행하여 로그인하세요.",
    'doctor.node': 'Node.js: {version}',
    'doctor.cwd': '작업 디렉토리: {path}',
    'doctor.manifests.count': '매니페스트: {count}개',
    'doctor.manifests.missing': '매니페스트 없음 (빌드 필요)',
    'doctor.tokens.missing': '토큰 없음 (auth login 필요)',
    'plugin.add.success': '플러그인 추가됨: {name}',
    'plugin.add.failed': '플러그인 추가 실패: {reason}',
    'plugin.remove.success': '플러그인 제거됨: {name}',
    'plugin.remove.notFound': "플러그인 '{name}'을(를) 찾을 수 없습니다.",
    'plugin.list.empty': '등록된 플러그인이 없습니다.',
    'completion.notInstalled.zsh': '~/.zshrc 에 다음을 추가하세요:',
    'completion.notInstalled.bash': '~/.bashrc 에 다음을 추가하세요:',
    'completion.unknownShell': "알 수 없는 셸: '{shell}' (지원: zsh, bash, fish)",
    'didYouMean.heading': '혹시 이 명령을 찾으셨나요?',
    'didYouMean.fallback': "'{cli} --help' 를 실행해 사용 가능한 명령을 확인하세요.",
    'common.unknown': '알 수 없는 오류',
  },
  en: {
    'auth.login.success': '{namespace} authenticated',
    'auth.login.failed': '{namespace} authentication failed: {reason}',
    'auth.required': 'Authentication required for namespace {namespace}.',
    'auth.run_login_hint': "Run '{cli} auth login {namespace}' to log in.",
    'doctor.node': 'Node.js: {version}',
    'doctor.cwd': 'Working directory: {path}',
    'doctor.manifests.count': 'Manifests: {count}',
    'doctor.manifests.missing': 'No manifests (build required)',
    'doctor.tokens.missing': 'No tokens (auth login required)',
    'plugin.add.success': 'Plugin added: {name}',
    'plugin.add.failed': 'Failed to add plugin: {reason}',
    'plugin.remove.success': 'Plugin removed: {name}',
    'plugin.remove.notFound': "Plugin '{name}' not found.",
    'plugin.list.empty': 'No plugins registered.',
    'completion.notInstalled.zsh': 'Add the following to ~/.zshrc:',
    'completion.notInstalled.bash': 'Add the following to ~/.bashrc:',
    'completion.unknownShell': "Unknown shell: '{shell}' (supported: zsh, bash, fish)",
    'didYouMean.heading': 'Did you mean?',
    'didYouMean.fallback': "Run '{cli} --help' to see available commands.",
    'common.unknown': 'Unknown error',
  },
}

/**
 * env 에서 사용자 언어를 감지한다. UNION_CLI_LANG > LANG > 'en'.
 */
export function detectLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const explicit = env.UNION_CLI_LANG
  if (explicit) {
    const norm = explicit.toLowerCase().split(/[._-]/)[0]
    if (norm === 'ko' || norm === 'en') return norm
  }
  const locale = env.LC_ALL ?? env.LANG ?? ''
  if (locale.toLowerCase().startsWith('ko')) return 'ko'
  return 'en'
}

let currentLang: Lang | null = null

/**
 * 명시적으로 언어를 설정. 다음 호출부터 적용.
 * 미호출 시 첫 t() 호출에서 detectLang() 으로 자동 결정.
 */
export function setLang(lang: Lang): void {
  currentLang = lang
}

/**
 * 추가 messages 를 catalogue 에 병합 (테스트/플러그인 확장).
 */
export function setMessages(lang: Lang, extra: MessageMap): void {
  Object.assign(messages[lang], extra)
}

/**
 * 메시지 조회 + 파라미터 치환.
 *
 * @param key - dotted message key (예: 'auth.login.success')
 * @param params - {placeholder} → params[placeholder] 치환
 * @param lang - 명시적 언어 override. 미지정 시 setLang() 또는 detectLang() 결과 사용.
 * @returns 치환된 문자열. messages 에 키가 없으면 en fallback, 그것도 없으면 key 자체.
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
  lang?: Lang,
): string {
  const resolvedLang = lang ?? currentLang ?? detectLang()
  const template = messages[resolvedLang]?.[key] ?? messages.en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const v = params[name]
    return v === undefined ? `{${name}}` : String(v)
  })
}
