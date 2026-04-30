import {existsSync, mkdirSync} from 'node:fs'
import fs from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

// ── 타입 ──

export interface AuditEntry {
  /** ISO 8601 timestamp (예: "2026-04-30T12:34:56.789Z") */
  timestamp: string
  namespace: string
  /** command id (예: "items:list") */
  command: string
  exitCode: number
  /** 실행 시간 (ms) */
  duration: number
  /** masked flags (민감 값은 "***"로 치환) */
  flags?: Record<string, unknown>
  /** 간단한 에러 메시지 */
  error?: string
}

export interface AuditOptions {
  /** false 또는 NO_AUDIT=1 / process.argv 에 --audit-off 가 포함되면 비활성화 */
  enabled?: boolean
  /** ~/.<cliName>/audit.log 위치 결정에 사용 */
  cliName: string
  /** 테스트 등에서 ~ 대신 사용할 base 디렉토리 */
  baseDir?: string
  /** 바이트 단위 회전 임계치. 기본 10MB */
  maxFileSize?: number
}

// ── 민감 flag 매칭 ──
// validator.ts 의 SENSITIVE_FLAG_PATTERNS 와 동일한 의미를 갖되,
// 모듈 의존성을 만들지 않도록 자체 정의 (validator 가 manifest 에 종속되어 있음).
const SENSITIVE_FLAG_PATTERN =
  /^(password|secret|token|api[_-]?key|credential|auth[_-]?token)$/i

const SENSITIVE_FLAG_HINT = /(password|secret|token|api[_-]?key|credential|auth[_-]?token)/i

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MASK = '***'

/**
 * 환경 변수 / process.argv 기반으로 audit log 가 비활성화되었는지 확인.
 */
export function isAuditDisabled(): boolean {
  const env = process.env.NO_AUDIT
  if (env && env !== '0' && env.toLowerCase() !== 'false') {
    return true
  }
  if (process.argv.includes('--audit-off')) {
    return true
  }
  return false
}

/**
 * flags 객체에서 민감 키의 값을 "***"로 마스킹한 사본을 반환.
 */
export function maskSensitiveFlags(
  flags: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!flags) return flags
  const masked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flags)) {
    if (SENSITIVE_FLAG_PATTERN.test(key) || SENSITIVE_FLAG_HINT.test(key)) {
      masked[key] = MASK
    } else {
      masked[key] = value
    }
  }
  return masked
}

// ── AuditLogger ──

export class AuditLogger {
  private readonly enabled: boolean
  private readonly logDir: string
  private readonly logPath: string
  private readonly rotatedPath: string
  private readonly maxFileSize: number
  /** 동시 record() 호출이 race condition 으로 rotate 를 동시에 하지 않도록 직렬화 */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(opts: AuditOptions) {
    const baseDir = opts.baseDir ?? homedir()
    this.logDir = join(baseDir, `.${opts.cliName}`)
    this.logPath = join(this.logDir, 'audit.log')
    this.rotatedPath = join(this.logDir, 'audit.log.1')
    this.maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
    // enabled 가 명시적으로 false 가 아니고 환경 변수도 비활성화되지 않은 경우 활성
    const explicit = opts.enabled !== false
    this.enabled = explicit && !isAuditDisabled()
  }

  /**
   * audit entry 를 JSON Lines 한 줄로 기록.
   * 비활성화 상태이면 no-op.
   */
  async record(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
    if (!this.enabled) return

    const fullEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
      flags: maskSensitiveFlags(entry.flags),
    }

    // 직렬화 — 동시 호출시에도 순서대로 처리
    const next = this.writeChain.then(() => this.writeEntry(fullEntry))
    // 에러는 swallow 해서 chain 이 깨지지 않도록 함 (audit 실패가 호출자 영향 안 주게)
    this.writeChain = next.catch(() => undefined)
    await next
  }

  /**
   * 최근 n 개 entry 반환. 파일이 없으면 빈 배열.
   * 손상된 라인은 스킵.
   */
  async tail(n: number): Promise<AuditEntry[]> {
    if (n <= 0) return []
    if (!existsSync(this.logPath)) return []

    let content: string
    try {
      content = await fs.readFile(this.logPath, 'utf-8')
    } catch {
      return []
    }
    const lines = content.split('\n').filter((l) => l.length > 0)
    const entries: AuditEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditEntry)
      } catch {
        // 손상된 라인 스킵
        continue
      }
    }
    return entries.slice(-n)
  }

  /**
   * 실제 파일 쓰기 + 회전.
   * private. record() 만 통해 호출됨.
   */
  private async writeEntry(entry: AuditEntry): Promise<void> {
    this.ensureDir()
    const line = JSON.stringify(entry) + '\n'

    // 회전: 새 라인을 추가하기 전에 현재 크기와 합쳐서 임계치 초과 시 회전.
    await this.rotateIfNeeded(Buffer.byteLength(line, 'utf-8'))

    const isNewFile = !existsSync(this.logPath)
    await fs.appendFile(this.logPath, line, 'utf-8')
    if (isNewFile) {
      // 0o600 — credential-store.ts 와 동일한 패턴
      try {
        await fs.chmod(this.logPath, 0o600)
      } catch {
        // best-effort: 권한 설정 실패해도 audit 는 계속
      }
    }
  }

  private async rotateIfNeeded(incoming: number): Promise<void> {
    if (!existsSync(this.logPath)) return
    let size: number
    try {
      const stat = await fs.stat(this.logPath)
      size = stat.size
    } catch {
      return
    }
    if (size + incoming <= this.maxFileSize) return

    // 단순 1단계 회전: audit.log → audit.log.1 (이전 .1 은 덮어씀)
    try {
      // rename 은 같은 파일시스템 내에서 atomic. 이전 .1 파일이 있으면 덮어쓴다.
      await fs.rename(this.logPath, this.rotatedPath)
      // 로테이션된 파일도 0o600 유지
      try {
        await fs.chmod(this.rotatedPath, 0o600)
      } catch {
        // best-effort
      }
    } catch {
      // rename 실패시 audit 자체를 막지 않음 — 다음 record 에서 재시도
    }
  }

  private ensureDir(): void {
    mkdirSync(this.logDir, {recursive: true})
  }
}
