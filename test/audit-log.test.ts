import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import fs from 'node:fs/promises'
import {existsSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  AuditLogger,
  isAuditDisabled,
  maskSensitiveFlags,
  type AuditEntry,
} from '../src/core/audit-log.js'

let baseDir: string
const CLI_NAME = 'audit-test-cli'

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-test-'))
  // NO_AUDIT 정리 — 이전 테스트 영향 차단
  delete process.env.NO_AUDIT
})

afterEach(async () => {
  await fs.rm(baseDir, {recursive: true, force: true})
  delete process.env.NO_AUDIT
})

function logPath(): string {
  return path.join(baseDir, `.${CLI_NAME}`, 'audit.log')
}

function rotatedPath(): string {
  return path.join(baseDir, `.${CLI_NAME}`, 'audit.log.1')
}

describe('AuditLogger.record', () => {
  it('case A — record() 시 audit.log 에 1줄이 추가되고 JSON 으로 파싱된다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({
      namespace: 'github',
      command: 'pr:list',
      exitCode: 0,
      duration: 123,
    })

    const content = await fs.readFile(logPath(), 'utf-8')
    const lines = content.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)

    const parsed = JSON.parse(lines[0]) as AuditEntry
    expect(parsed.namespace).toBe('github')
    expect(parsed.command).toBe('pr:list')
    expect(parsed.exitCode).toBe(0)
    expect(parsed.duration).toBe(123)
    expect(typeof parsed.timestamp).toBe('string')
    // ISO 8601 format check
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('여러 record() 호출은 JSONL 형식으로 각 라인 1 entry 로 누적된다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({namespace: 'a', command: 'x', exitCode: 0, duration: 1})
    await logger.record({namespace: 'b', command: 'y', exitCode: 1, duration: 2})
    await logger.record({namespace: 'c', command: 'z', exitCode: 0, duration: 3})

    const content = await fs.readFile(logPath(), 'utf-8')
    const lines = content.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(3)
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow()
    }
  })
})

describe('AuditLogger.tail', () => {
  it('case B — tail(n) 은 최근 n 개 entry 를 반환한다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    for (let i = 0; i < 15; i++) {
      await logger.record({
        namespace: 'ns',
        command: `cmd-${i}`,
        exitCode: 0,
        duration: i,
      })
    }

    const tail10 = await logger.tail(10)
    expect(tail10).toHaveLength(10)
    expect(tail10[0]?.command).toBe('cmd-5')
    expect(tail10[9]?.command).toBe('cmd-14')
  })

  it('파일이 없으면 빈 배열을 반환한다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    const result = await logger.tail(5)
    expect(result).toEqual([])
  })

  it('n <= 0 이면 빈 배열을 반환한다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({namespace: 'n', command: 'c', exitCode: 0, duration: 1})
    expect(await logger.tail(0)).toEqual([])
    expect(await logger.tail(-1)).toEqual([])
  })

  it('손상된 JSON 라인은 스킵한다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({namespace: 'n', command: 'c1', exitCode: 0, duration: 1})
    // 직접 손상된 라인 추가
    await fs.appendFile(logPath(), 'not-json{{\n', 'utf-8')
    await logger.record({namespace: 'n', command: 'c2', exitCode: 0, duration: 2})

    const tail = await logger.tail(10)
    expect(tail).toHaveLength(2)
    expect(tail.map((e) => e.command)).toEqual(['c1', 'c2'])
  })
})

describe('AuditLogger 민감 flag 마스킹', () => {
  it('case C — 민감 flag (password=secret) 은 "***" 로 마스킹된다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({
      namespace: 'auth',
      command: 'login',
      exitCode: 0,
      duration: 100,
      flags: {
        password: 'super-secret-1234',
        username: 'alice',
      },
    })

    const [entry] = await logger.tail(1)
    expect(entry.flags?.password).toBe('***')
    expect(entry.flags?.username).toBe('alice')
  })

  it('다양한 민감 키를 마스킹한다 (token, api_key, api-key, secret, credential, auth_token)', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({
      namespace: 'svc',
      command: 'do',
      exitCode: 0,
      duration: 1,
      flags: {
        token: 't1',
        api_key: 'k1',
        'api-key': 'k2',
        secret: 's1',
        credential: 'c1',
        auth_token: 'a1',
        normal: 'visible',
      },
    })
    const [entry] = await logger.tail(1)
    expect(entry.flags?.token).toBe('***')
    expect(entry.flags?.api_key).toBe('***')
    expect(entry.flags?.['api-key']).toBe('***')
    expect(entry.flags?.secret).toBe('***')
    expect(entry.flags?.credential).toBe('***')
    expect(entry.flags?.auth_token).toBe('***')
    expect(entry.flags?.normal).toBe('visible')
  })

  it('maskSensitiveFlags 는 undefined 입력에 대해 undefined 를 반환한다', () => {
    expect(maskSensitiveFlags(undefined)).toBeUndefined()
  })

  it('maskSensitiveFlags 는 빈 객체에 대해 빈 객체를 반환한다', () => {
    expect(maskSensitiveFlags({})).toEqual({})
  })
})

describe('AuditLogger 회전', () => {
  it('case D — maxFileSize 초과 시 audit.log.1 로 rotate 되고 새 entry 는 새 파일에 기록된다', async () => {
    // 한 entry 가 ~100B 정도이므로 maxFileSize=150 으로 설정하면
    // 두 번째 record 호출 시점에 회전이 발생함 (100 + 100 > 150).
    const logger = new AuditLogger({
      cliName: CLI_NAME,
      baseDir,
      maxFileSize: 150,
    })

    // 첫 record — 정상 기록
    await logger.record({
      namespace: 'ns',
      command: 'first',
      exitCode: 0,
      duration: 1,
    })
    // 두번째 record — 누적 크기가 임계치를 넘으면서 회전 발생: first 가 .1 로 이동
    await logger.record({
      namespace: 'ns',
      command: 'second',
      exitCode: 0,
      duration: 2,
    })

    // 회전 후 두 파일이 모두 존재해야 함
    expect(existsSync(rotatedPath())).toBe(true)
    expect(existsSync(logPath())).toBe(true)

    // 단순 1단계 회전: .1 에는 회전 직전의 audit.log 내용 ("first") 이 있어야 함
    const rotatedContent = await fs.readFile(rotatedPath(), 'utf-8')
    expect(rotatedContent).toContain('"command":"first"')
    expect(rotatedContent).not.toContain('"command":"second"')

    // 새 파일에는 회전 이후 기록된 entry ("second") 만 있어야 함
    const newContent = await fs.readFile(logPath(), 'utf-8')
    expect(newContent).toContain('"command":"second"')
    expect(newContent).not.toContain('"command":"first"')
  })

  it('회전이 반복되면 이전 .1 은 덮어쓰여진다 (단순 1단계 회전)', async () => {
    const logger = new AuditLogger({
      cliName: CLI_NAME,
      baseDir,
      maxFileSize: 150,
    })

    // 매 record 마다 회전 발생 (entry 크기 ~100B, threshold 150)
    await logger.record({namespace: 'ns', command: 'a', exitCode: 0, duration: 1})
    await logger.record({namespace: 'ns', command: 'b', exitCode: 0, duration: 2})
    // 시점: .1 = a, audit.log = b
    await logger.record({namespace: 'ns', command: 'c', exitCode: 0, duration: 3})
    // 시점: .1 = b (a 는 덮어쓰여 사라짐), audit.log = c

    const rotatedContent = await fs.readFile(rotatedPath(), 'utf-8')
    expect(rotatedContent).toContain('"command":"b"')
    expect(rotatedContent).not.toContain('"command":"a"')

    const newContent = await fs.readFile(logPath(), 'utf-8')
    expect(newContent).toContain('"command":"c"')
  })
})

describe('AuditLogger 비활성화', () => {
  it('case E — NO_AUDIT=1 이면 record() 는 no-op 이다', async () => {
    process.env.NO_AUDIT = '1'
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({namespace: 'n', command: 'c', exitCode: 0, duration: 1})

    expect(existsSync(logPath())).toBe(false)
    expect(await logger.tail(10)).toEqual([])
  })

  it('NO_AUDIT=0 / NO_AUDIT=false 는 비활성화로 간주하지 않는다', async () => {
    process.env.NO_AUDIT = '0'
    const logger0 = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger0.record({namespace: 'n', command: 'c', exitCode: 0, duration: 1})
    expect(existsSync(logPath())).toBe(true)
  })

  it('enabled: false 옵션은 record 를 비활성화한다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir, enabled: false})
    await logger.record({namespace: 'n', command: 'c', exitCode: 0, duration: 1})
    expect(existsSync(logPath())).toBe(false)
  })

  it('isAuditDisabled 는 NO_AUDIT 값을 검사한다', () => {
    delete process.env.NO_AUDIT
    expect(isAuditDisabled()).toBe(false)
    process.env.NO_AUDIT = '1'
    expect(isAuditDisabled()).toBe(true)
    process.env.NO_AUDIT = 'true'
    expect(isAuditDisabled()).toBe(true)
    process.env.NO_AUDIT = '0'
    expect(isAuditDisabled()).toBe(false)
    process.env.NO_AUDIT = 'false'
    expect(isAuditDisabled()).toBe(false)
  })
})

describe('AuditLogger 파일 권한', () => {
  it('case F — audit.log 파일은 chmod 0600 으로 생성된다', async () => {
    const logger = new AuditLogger({cliName: CLI_NAME, baseDir})
    await logger.record({namespace: 'n', command: 'c', exitCode: 0, duration: 1})

    const stat = await fs.stat(logPath())
    expect(stat.mode & 0o777).toBe(0o600)
  })
})
