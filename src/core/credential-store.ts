import {execFileSync, spawnSync} from 'node:child_process'
import {mkdirSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {logger} from './logger.js'
import type {SecretRef} from './types.js'

// ── CredentialStore interface ──

export interface CredentialStore {
  get(ns: string): Promise<Record<string, string> | null>
  set(ns: string, creds: Record<string, string>): Promise<void>
  delete(ns: string): Promise<void>
  /** Optional: list namespaces. Not all stores support it (e.g., env). */
  list?(): Promise<string[]>
}

// ── FileCredentialStore ──

export class FileCredentialStore implements CredentialStore {
  constructor(private readonly credentialsDir: string) {}

  private filePath(ns: string): string {
    return path.join(this.credentialsDir, `${ns}.json`)
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.credentialsDir, {recursive: true})
  }

  async get(ns: string): Promise<Record<string, string> | null> {
    try {
      const data = await fs.readFile(this.filePath(ns), 'utf-8')
      return JSON.parse(data) as Record<string, string>
    } catch {
      return null
    }
  }

  async set(ns: string, creds: Record<string, string>): Promise<void> {
    await this.ensureDir()
    const fp = this.filePath(ns)
    await fs.writeFile(fp, JSON.stringify(creds, null, 2), 'utf-8')
    await fs.chmod(fp, 0o600)
  }

  async delete(ns: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(ns))
    } catch {
      // ignore if file doesn't exist
    }
  }

  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.credentialsDir, {withFileTypes: true})
      return entries
        .filter(e => e.isFile() && e.name.endsWith('.json'))
        .map(e => e.name.replace(/\.json$/, ''))
    } catch {
      return []
    }
  }
}

// ── EnvCredentialStore ──

export class EnvCredentialStore implements CredentialStore {
  /**
   * @param cliName 환경변수 prefix 용도. 지정 시 `<CLI_UPPER>_<NS_UPPER>_TOKEN` 형식,
   *                미지정 시 (legacy) `<NS_UPPER>_TOKEN` 형식.
   */
  constructor(private readonly cliName?: string) {}

  private envKey(ns: string): string {
    const nsUpper = ns.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    if (this.cliName) {
      const cliUpper = this.cliName.toUpperCase().replace(/[^A-Z0-9]/g, '_')
      return `${cliUpper}_${nsUpper}_TOKEN`
    }
    return `${nsUpper}_TOKEN`
  }

  async get(ns: string): Promise<Record<string, string> | null> {
    const key = this.envKey(ns)
    const token = process.env[key]
    if (!token) {
      // Backward-compat: also try legacy form (no cliName prefix) when cliName is set.
      if (this.cliName) {
        const legacyKey = `${ns.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`
        const legacyToken = process.env[legacyKey]
        if (legacyToken) return {token: legacyToken}
      }
      return null
    }
    return {token}
  }

  async set(_ns: string, _creds: Record<string, string>): Promise<void> {
    // Environment variables are immutable from the application's perspective.
    // Throw to make CI/CD misconfiguration loud and obvious.
    throw new Error(
      'EnvCredentialStore is read-only. Set the corresponding environment variable instead of calling set().',
    )
  }

  async delete(_ns: string): Promise<void> {
    throw new Error(
      'EnvCredentialStore is read-only. Unset the corresponding environment variable instead of calling delete().',
    )
  }
}

// ── KeychainCredentialStore ──

/**
 * OS native secure storage 어댑터.
 *
 * - macOS: `security` (Keychain Services CLI)
 * - Linux: `secret-tool` (libsecret)
 * - Windows: `cmdkey` (Generic Credential)
 *
 * 각 플랫폼의 도구가 설치되어 있지 않거나 명령 실행에 실패하면
 * 실패를 throw 하므로, 호출자(factory 등)가 fallback 정책을 결정할 수 있다.
 *
 * 저장 형식: credential 의 모든 key/value 를 JSON 으로 직렬화하여
 *           단일 secret 으로 보관한다 (account: 'default' 사용).
 */
export class KeychainCredentialStore implements CredentialStore {
  private readonly platform: NodeJS.Platform
  private readonly account: string
  private readonly cliName: string

  constructor(opts: {cliName: string; account?: string; platform?: NodeJS.Platform}) {
    this.cliName = opts.cliName
    this.account = opts.account ?? (os.userInfo().username || 'default')
    this.platform = opts.platform ?? process.platform
  }

  /** Service identifier — 충돌 방지를 위해 cli-name 와 namespace 를 결합한다. */
  private serviceName(ns: string): string {
    return `${this.cliName}-${ns}`
  }

  /** 특정 플랫폼의 keychain CLI 가 PATH 에 존재하는지 검증한다. */
  static isAvailable(platform: NodeJS.Platform = process.platform): boolean {
    const tool = KeychainCredentialStore.toolName(platform)
    if (!tool) return false
    try {
      // `command -v` 는 POSIX, `where` 는 Windows. spawnSync 로 빠르게 PATH 조회.
      if (platform === 'win32') {
        const r = spawnSync('where', [tool], {stdio: 'ignore'})
        return r.status === 0
      }
      const r = spawnSync('sh', ['-c', `command -v ${tool}`], {stdio: 'ignore'})
      return r.status === 0
    } catch {
      return false
    }
  }

  private static toolName(platform: NodeJS.Platform): string | null {
    switch (platform) {
      case 'darwin':
        return 'security'
      case 'linux':
        return 'secret-tool'
      case 'win32':
        return 'cmdkey'
      default:
        return null
    }
  }

  // ── 플랫폼별 read/write/delete ──

  async get(ns: string): Promise<Record<string, string> | null> {
    const svc = this.serviceName(ns)
    try {
      switch (this.platform) {
        case 'darwin':
          return this.getMacOS(svc)
        case 'linux':
          return this.getLinux(svc)
        case 'win32':
          return this.getWindows(svc)
        default:
          throw new Error(`KeychainCredentialStore: unsupported platform "${this.platform}"`)
      }
    } catch (err) {
      // 도구 미설치는 throw, 단순 "not found" 는 null
      if (isNotFoundError(err)) return null
      throw err
    }
  }

  async set(ns: string, creds: Record<string, string>): Promise<void> {
    const svc = this.serviceName(ns)
    const payload = JSON.stringify(creds)
    switch (this.platform) {
      case 'darwin':
        this.setMacOS(svc, payload)
        return
      case 'linux':
        this.setLinux(svc, payload)
        return
      case 'win32':
        this.setWindows(svc, payload)
        return
      default:
        throw new Error(`KeychainCredentialStore: unsupported platform "${this.platform}"`)
    }
  }

  async delete(ns: string): Promise<void> {
    const svc = this.serviceName(ns)
    try {
      switch (this.platform) {
        case 'darwin':
          this.deleteMacOS(svc)
          return
        case 'linux':
          this.deleteLinux(svc)
          return
        case 'win32':
          this.deleteWindows(svc)
          return
        default:
          throw new Error(`KeychainCredentialStore: unsupported platform "${this.platform}"`)
      }
    } catch (err) {
      // 이미 없는 entry 의 delete 는 silent
      if (isNotFoundError(err)) return
      throw err
    }
  }

  // ── macOS: security ──

  private getMacOS(svc: string): Record<string, string> | null {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', svc, '-a', this.account, '-w'],
      {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']},
    )
    return parsePayload(out.trimEnd())
  }

  private setMacOS(svc: string, payload: string): void {
    // -U: 이미 존재하면 update. -w 로 password 인자 전달.
    execFileSync(
      'security',
      ['add-generic-password', '-s', svc, '-a', this.account, '-w', payload, '-U'],
      {stdio: ['ignore', 'ignore', 'pipe']},
    )
  }

  private deleteMacOS(svc: string): void {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', svc, '-a', this.account],
      {stdio: ['ignore', 'ignore', 'pipe']},
    )
  }

  // ── Linux: secret-tool ──

  private getLinux(svc: string): Record<string, string> | null {
    const out = execFileSync(
      'secret-tool',
      ['lookup', 'service', svc, 'account', this.account],
      {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']},
    )
    // secret-tool returns empty stdout + non-zero exit when not found.
    const trimmed = out.trimEnd()
    if (!trimmed) return null
    return parsePayload(trimmed)
  }

  private setLinux(svc: string, payload: string): void {
    // `secret-tool store --label <l> service <s> account <a>` reads password from stdin.
    const label = `${this.cliName}: ${svc}`
    const r = spawnSync(
      'secret-tool',
      ['store', '--label', label, 'service', svc, 'account', this.account],
      {input: payload, encoding: 'utf-8'},
    )
    if (r.error) throw r.error
    if (r.status !== 0) {
      const stderr = (r.stderr ?? '').toString().trim()
      throw new Error(`secret-tool store failed (exit ${r.status}): ${stderr}`)
    }
  }

  private deleteLinux(svc: string): void {
    const r = spawnSync(
      'secret-tool',
      ['clear', 'service', svc, 'account', this.account],
      {encoding: 'utf-8'},
    )
    if (r.error) throw r.error
    if (r.status !== 0) {
      const stderr = (r.stderr ?? '').toString().trim()
      // secret-tool clear is idempotent on missing entries on most versions; treat 1 with empty stderr as not-found
      if (!stderr) return
      throw new Error(`secret-tool clear failed (exit ${r.status}): ${stderr}`)
    }
  }

  // ── Windows: cmdkey ──
  //
  // Note: cmdkey 는 password 자체를 plain 으로 회수할 수 없는 제약이 있다.
  // 실용적 우회를 위해 namespace 별로 두 개의 entry 를 사용한다:
  //   1. Generic Credential entry: `cmdkey /generic` — list/존재 확인용
  //   2. 실제 payload: `<APPDATA>/<cliName>/keychain-fallback/<ns>.json` (chmod 불가, NTFS ACL 의존)
  // 완전한 OS-secure 저장이 필요하면 PowerShell `Export-Clixml` (DPAPI) 또는
  // Windows Credential Manager API (native binding) 가 필요하다 — keytar 도입 검토를 follow-up 으로 남긴다.

  private windowsFallbackPath(svc: string): string {
    const base = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(base, this.cliName, 'keychain-fallback', `${svc}.json`)
  }

  private getWindows(svc: string): Record<string, string> | null {
    // 1) credential entry 가 존재하는지 확인 (없으면 null)
    const list = execFileSync('cmdkey', ['/list:' + svc], {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']})
    if (!list.includes(svc)) return null

    // 2) 실제 payload 는 사이드카 파일에서 회수
    try {
      const fp = this.windowsFallbackPath(svc)
      const data = readFileSync(fp, 'utf-8')
      return parsePayload(data)
    } catch {
      return null
    }
  }

  private setWindows(svc: string, payload: string): void {
    // cmdkey 자체에는 일종의 "marker" 로만 등록 (password 인자에 placeholder)
    execFileSync(
      'cmdkey',
      ['/generic:' + svc, '/user:' + this.account, '/pass:' + 'union-cli-marker'],
      {stdio: ['ignore', 'ignore', 'pipe']},
    )
    // 실제 payload 는 사이드카 파일에. 디렉토리 생성 후 평문 저장.
    // (NTFS ACL 이 사용자별 격리를 제공하지만, 더 강한 보호는 keytar 도입 후속)
    const fp = this.windowsFallbackPath(svc)
    mkdirSync(path.dirname(fp), {recursive: true})
    writeFileSync(fp, payload, 'utf-8')
  }

  private deleteWindows(svc: string): void {
    try {
      execFileSync('cmdkey', ['/delete:' + svc], {stdio: ['ignore', 'ignore', 'pipe']})
    } catch {
      // not registered → ignore
    }
    try {
      const fp = this.windowsFallbackPath(svc)
      unlinkSync(fp)
    } catch {
      // ignore
    }
  }
}

// ── Helpers ──

function parsePayload(raw: string): Record<string, string> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
    return null
  } catch {
    // 비-JSON 문자열은 token 단일 값으로 간주 (legacy/manual 추가 호환)
    return {token: raw}
  }
}

/**
 * exec/spawn 결과가 "엔트리 없음" 에러인지 추정한다.
 *
 * - macOS `security`: exit 44 ("The specified item could not be found")
 * - Linux `secret-tool lookup`: not found 시 exit 1 + 빈 stdout
 * - Windows `cmdkey /list`: 미등록 entry 시 exit 1 ("ERROR: 자격 증명...")
 */
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as {status?: number; stderr?: Buffer | string; code?: string}
  // ENOENT (binary missing) — 호출자가 fallback 결정해야 하므로 not-found 가 아님
  if (e.code === 'ENOENT') return false
  const stderr = e.stderr ? e.stderr.toString() : ''
  if (e.status === 44) return true // macOS security
  if (e.status === 1 && /could not be found|no matching|specified item/i.test(stderr)) return true
  if (e.status === 1 && stderr === '') return true // secret-tool lookup not-found
  return false
}

// ── Factory ──

export interface CredentialStoreOptions {
  /** 'file' (default) | 'keychain' | 'env' */
  type?: 'file' | 'keychain' | 'env'
  /** CLI 이름 (keychain service 식별자 / env prefix 에 사용) */
  cliName: string
  /** FileStore 의 base directory. 기본 ~/.<cliName>/credentials */
  baseDir?: string
  /** keychain account (기본: 현재 OS user) */
  account?: string
  /** 테스트용 platform override */
  platform?: NodeJS.Platform
  /** keychain 미설치 시 FileStore 로 fallback (default: true) */
  fallbackToFile?: boolean
}

/**
 * Manifest 의 `provider.config.credentialStore` 값 + cliName 을 받아
 * 적절한 CredentialStore 인스턴스를 생성한다.
 *
 * - type='file' (default): chmod 0600 의 ~/.<cli>/credentials/<ns>.json
 * - type='keychain': OS 네이티브 secure storage. 도구 미설치 시 FileStore fallback (warning 출력).
 * - type='env': `<CLI>_<NS>_TOKEN` 환경변수에서 read-only 로 회수 (CI/CD 용).
 */
export function createCredentialStore(opts: CredentialStoreOptions): CredentialStore {
  const type = opts.type ?? 'file'
  const baseDir = opts.baseDir ?? path.join(os.homedir(), `.${opts.cliName}`, 'credentials')

  switch (type) {
    case 'env':
      return new EnvCredentialStore(opts.cliName)

    case 'keychain': {
      const platform = opts.platform ?? process.platform
      if (KeychainCredentialStore.isAvailable(platform)) {
        return new KeychainCredentialStore({
          cliName: opts.cliName,
          account: opts.account,
          platform,
        })
      }
      // graceful fallback
      if (opts.fallbackToFile === false) {
        throw new Error(
          `KeychainCredentialStore: required CLI tool not found on platform "${platform}". ` +
          `Install the OS keystore CLI (security/secret-tool/cmdkey) or set credentialStore=file.`,
        )
      }
      logger.warn(
        `OS keystore CLI not found on platform "${platform}"; falling back to FileCredentialStore (${baseDir}).`,
      )
      return new FileCredentialStore(baseDir)
    }

    case 'file':
    default:
      return new FileCredentialStore(baseDir)
  }
}

// ── resolveSecret ──

export async function resolveSecret(ref: SecretRef): Promise<string | null> {
  if (ref.env) {
    return process.env[ref.env] ?? null
  }

  if (ref.file) {
    try {
      return await fs.readFile(ref.file, 'utf-8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        return null
      }
      if (nodeErr.code === 'EACCES') {
        throw new Error(`Permission denied reading secret file: "${ref.file}". Check file permissions.`, {cause: err})
      }
      throw err
    }
  }

  if (ref.command) {
    try {
      const parts = ref.command.split(/\s+/)
      const result = execFileSync(parts[0], parts.slice(1), {timeout: 10000, encoding: 'utf-8'})
      return result.trim()
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        throw new Error(`Command not found: "${ref.command.split(/\s+/)[0]}". Ensure it is installed and in your PATH.`, {cause: err})
      }
      const execErr = err as {status?: number; stderr?: Buffer | string}
      const stderr = execErr.stderr ? execErr.stderr.toString().trim() : ''
      const exitCode = execErr.status ?? 'unknown'
      throw new Error(`Secret command failed (exit code ${exitCode}): "${ref.command}"${stderr ? `\n${stderr}` : ''}`, {cause: err})
    }
  }

  if (ref.value !== undefined) {
    return ref.value
  }

  return null
}
