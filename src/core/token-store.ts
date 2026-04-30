import {readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, copyFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {pbkdf2Sync, createDecipheriv} from 'node:crypto'
import {logger} from './logger.js'
import {CACHE_DIR} from './constants.js'

export function getTokensPath(): string {
  return join(process.cwd(), CACHE_DIR, 'tokens.json')
}

export function loadTokens(): Record<string, unknown> {
  const p = getTokensPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function saveTokens(tokens: Record<string, unknown>): void {
  const dir = join(process.cwd(), CACHE_DIR)
  mkdirSync(dir, {recursive: true})
  writeFileSync(join(dir, 'tokens.json'), JSON.stringify(tokens, null, 2))
}

export function deleteTokenForNamespace(namespace: string): boolean {
  const tokens = loadTokens()
  if (!(namespace in tokens)) return false
  delete tokens[namespace]
  saveTokens(tokens)
  return true
}

export function deleteAllTokens(): boolean {
  const p = getTokensPath()
  if (!existsSync(p)) return false
  unlinkSync(p)
  return true
}

export interface ChromeCookie {
  name: string
  value: string
}

// ── Chromium 계열 브라우저 정의 ──

interface BrowserDef {
  name: string
  dir: string              // $HOME 기준 상대 경로
  keychainService: string  // macOS Keychain 서비스명
}

const BROWSERS: BrowserDef[] = [
  {name: 'Chrome', dir: 'Library/Application Support/Google/Chrome', keychainService: 'Chrome Safe Storage'},
  {name: 'Brave', dir: 'Library/Application Support/BraveSoftware/Brave-Browser', keychainService: 'Brave Safe Storage'},
  {name: 'Edge', dir: 'Library/Application Support/Microsoft Edge', keychainService: 'Microsoft Edge Safe Storage'},
  {name: 'Chromium', dir: 'Library/Application Support/Chromium', keychainService: 'Chromium Safe Storage'},
]

// ── 헬퍼 ──

export function discoverProfiles(browserDir: string): string[] {
  if (!existsSync(browserDir)) return []
  return readdirSync(browserDir, {withFileTypes: true})
    .filter(e => e.isDirectory() && existsSync(join(browserDir, e.name, 'Cookies')))
    .map(e => e.name)
}

export function decryptCookieValue(encryptedValue: Buffer, key: Buffer): string {
  // Chrome v10 prefix (3 bytes) 제거
  if (encryptedValue.length < 4 || encryptedValue.subarray(0, 3).toString() !== 'v10') return ''
  const data = encryptedValue.subarray(3)
  const iv = Buffer.alloc(16, ' ') // 16-space IV (Chrome macOS 표준)
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, iv)
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
    return decrypted.toString('utf-8')
  } catch {
    return ''
  }
}

// ── 메인: Chrome 쿠키 추출 ──

export function decryptChromeCookies(host: string): ChromeCookie[] | null {
  if (process.platform !== 'darwin') {
    logger.debug('[cookie] macOS만 지원합니다')
    return null
  }

  const homeDir = process.env.HOME || ''
  const searched: string[] = []

  for (const browser of BROWSERS) {
    const browserDir = join(homeDir, browser.dir)
    const profiles = discoverProfiles(browserDir)
    if (profiles.length === 0) continue

    // Keychain에서 Safe Storage 비밀번호 가져오기 (브라우저당 1회)
    let safeStorageKey: Buffer
    try {
      const raw = execFileSync('security', [
        'find-generic-password', '-s', browser.keychainService, '-w',
      ], {stdio: ['pipe', 'pipe', 'pipe']})
      safeStorageKey = raw.subarray(0, -1) // trailing newline 제거
    } catch {
      logger.debug(`[cookie] ${browser.name}: Keychain 키를 찾을 수 없음`)
      continue
    }

    // PBKDF2 키 유도 (Chrome macOS 표준: sha1, saltysalt, 1003 iter, 16 bytes)
    const key = pbkdf2Sync(safeStorageKey, 'saltysalt', 1003, 16, 'sha1')

    for (const profile of profiles) {
      const dbPath = join(browserDir, profile, 'Cookies')
      searched.push(`${browser.name}/${profile}`)

      try {
        // SQLite DB를 임시 파일로 복사 (Chrome lock 회피)
        const tmpPath = join(tmpdir(), `union-cli-cookies-${Date.now()}.db`)
        copyFileSync(dbPath, tmpPath)

        // sqlite3 CLI로 쿠키 조회 (host_key 정확매칭 + 도메인 쿠키 .host 매칭)
        const safeHost = host.replace(/'/g, "''")
        const query = `SELECT name, hex(encrypted_value) FROM cookies WHERE host_key = '${safeHost}' OR host_key = '.${safeHost}';`
        const output = execFileSync('sqlite3', [tmpPath, query], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        }).toString().trim()

        // 임시 파일 정리
        try { unlinkSync(tmpPath) } catch { /* ignore */ }

        if (!output) continue

        // sqlite3 출력 파싱: "name|hex_value" 행 단위
        const cookies: ChromeCookie[] = []
        for (const line of output.split('\n')) {
          const sep = line.indexOf('|')
          if (sep < 0) continue
          const name = line.substring(0, sep)
          const hexValue = line.substring(sep + 1)
          if (!hexValue) continue

          const encrypted = Buffer.from(hexValue, 'hex')
          const value = decryptCookieValue(encrypted, key)
          if (value) {
            const jwtMatch = value.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
            cookies.push({name, value: jwtMatch ? jwtMatch[0] : value})
          }
        }

        if (cookies.length > 0) {
          logger.debug(`[cookie] ${browser.name}/${profile}에서 ${cookies.length}개 쿠키 발견`)
          return cookies
        }
      } catch (err) {
        logger.debug(`[cookie] ${browser.name}/${profile}: ${String(err)}`)
        continue
      }
    }
  }

  logger.debug(`[cookie] "${host}" 쿠키를 찾지 못함 (탐색: ${searched.join(', ') || '없음'})`)
  return null
}
