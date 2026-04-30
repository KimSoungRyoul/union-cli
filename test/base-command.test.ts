import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {EventEmitter} from 'node:events'
import type {Interface as ReadlineInterface} from 'node:readline'
import {Flags} from '@oclif/core'

import {BaseCommand} from '../src/core/base-command.js'

// readline 모듈 mock (ESM 제약으로 spyOn 불가)
let __mockAnswers: string[] = []
let __mockIdx = 0

vi.mock('node:readline', () => {
  return {
    createInterface: (): ReadlineInterface => {
      const fake = new EventEmitter() as unknown as ReadlineInterface & {
        question: (q: string, cb: (a: string) => void) => void
        close: () => void
      }
      fake.question = (_q: string, cb: (a: string) => void): void => {
        const answer = __mockAnswers[__mockIdx++] ?? ''
        setImmediate(() => cb(answer))
      }
      fake.close = (): void => {
        // noop
      }
      return fake as unknown as ReadlineInterface
    },
  }
})

function mockReadlineAnswer(answers: string[]): void {
  __mockAnswers = answers
  __mockIdx = 0
}

// ── 환경 백업/복원 ──

let savedEnv: NodeJS.ProcessEnv
let savedIsTTY: boolean | undefined

beforeEach(() => {
  savedEnv = {...process.env}
  delete process.env.NO_INPUT
  delete process.env.UNION_CLI_NO_INPUT
  savedIsTTY = process.stdin.isTTY
})

afterEach(() => {
  process.env = savedEnv
  Object.defineProperty(process.stdin, 'isTTY', {value: savedIsTTY, configurable: true})
  vi.restoreAllMocks()
})

function setTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {value: isTTY, configurable: true})
}

// ── Test fixture: 누락 검출 검증용 BaseCommand 서브클래스 ──
//
// 실제 oclif 의 init() 흐름 (config 필요) 을 우회하기 위해,
// 여기서는 protected 메서드 (findMissingRequiredFlags, maybePromptMissingRequiredFlags)
// 를 직접 호출해 단위 테스트한다.

class TestCommand extends BaseCommand {
  static flags = {
    username: Flags.string({description: 'login name', required: true}),
    region: Flags.string({description: 'AWS region', required: true}),
    optional: Flags.string({description: 'optional flag'}),
    debugFlag: Flags.boolean({description: 'a boolean required flag', required: true}),
  }
  async run(): Promise<void> {
    // noop — tests don't run this
  }
}

class WithSecretCommand extends BaseCommand {
  static flags = {
    password: Flags.string({description: 'login password', required: true}),
  }
  async run(): Promise<void> {
    // noop
  }
}

class NoRequiredCommand extends BaseCommand {
  static flags = {
    optional: Flags.string({description: 'optional flag'}),
  }
  async run(): Promise<void> {
    // noop
  }
}

/**
 * BaseCommand 인스턴스를 oclif config 없이 만들기 위한 헬퍼.
 * argv 만 세팅하고 protected 메서드를 호출한다.
 */
function makeCommandStub<T extends BaseCommand>(
  CommandClass: new (argv: string[], config: unknown) => T,
  argv: string[],
): T {
  // config 는 init() 에서 사용하지 않는 메서드만 호출하므로 빈 객체로 충분.
  const cmd = new CommandClass(argv, {} as unknown as never)
  // BaseCommand 의 argv 프로퍼티 직접 세팅
  ;(cmd as unknown as {argv: string[]}).argv = argv
  return cmd
}

// ── findMissingRequiredFlags ──

describe('BaseCommand.findMissingRequiredFlags', () => {
  it('case G-prep — required flag 가 모두 누락되면 모두 반환', () => {
    const cmd = makeCommandStub(TestCommand, [])
    const missing = (cmd as unknown as {
      findMissingRequiredFlags(): Array<{name: string}>
    }).findMissingRequiredFlags()
    const names = missing.map(m => m.name)
    expect(names).toContain('username')
    expect(names).toContain('region')
    // boolean 타입 required 는 prompt 대상이 아니므로 제외
    expect(names).not.toContain('debugFlag')
    // optional 은 required 아니므로 제외
    expect(names).not.toContain('optional')
  })

  it('--username 이 들어있으면 누락에서 제외', () => {
    const cmd = makeCommandStub(TestCommand, ['--username', 'alice'])
    const missing = (cmd as unknown as {
      findMissingRequiredFlags(): Array<{name: string}>
    }).findMissingRequiredFlags()
    const names = missing.map(m => m.name)
    expect(names).not.toContain('username')
    expect(names).toContain('region')
  })

  it('--username=alice (= 형식) 도 누락 아님', () => {
    const cmd = makeCommandStub(TestCommand, ['--username=alice'])
    const missing = (cmd as unknown as {
      findMissingRequiredFlags(): Array<{name: string}>
    }).findMissingRequiredFlags()
    const names = missing.map(m => m.name)
    expect(names).not.toContain('username')
  })

  it('password 류 이름은 hidden=true 로 표시', () => {
    const cmd = makeCommandStub(WithSecretCommand, [])
    const missing = (cmd as unknown as {
      findMissingRequiredFlags(): Array<{name: string; hidden?: boolean}>
    }).findMissingRequiredFlags()
    expect(missing[0].name).toBe('password')
    expect(missing[0].hidden).toBe(true)
  })

  it('required flag 가 없으면 빈 배열', () => {
    const cmd = makeCommandStub(NoRequiredCommand, [])
    const missing = (cmd as unknown as {
      findMissingRequiredFlags(): Array<{name: string}>
    }).findMissingRequiredFlags()
    expect(missing).toEqual([])
  })
})

// ── maybePromptMissingRequiredFlags ──

describe('BaseCommand.maybePromptMissingRequiredFlags', () => {
  it('case G — TTY + required 누락 → prompt 후 argv 에 주입', async () => {
    setTTY(true)
    mockReadlineAnswer(['alice', 'us-east-1'])
    const cmd = makeCommandStub(TestCommand, [])
    await (cmd as unknown as {
      maybePromptMissingRequiredFlags(): Promise<void>
    }).maybePromptMissingRequiredFlags()

    // argv 에 prompt 결과가 주입되었어야 함
    const argv = (cmd as unknown as {argv: string[]}).argv
    expect(argv).toContain('--username')
    expect(argv).toContain('alice')
    expect(argv).toContain('--region')
    expect(argv).toContain('us-east-1')
  })

  it('case H — non-TTY + required 누락 → 아무 것도 하지 않음 (oclif 가 처리)', async () => {
    setTTY(false)
    const cmd = makeCommandStub(TestCommand, [])
    await (cmd as unknown as {
      maybePromptMissingRequiredFlags(): Promise<void>
    }).maybePromptMissingRequiredFlags()

    const argv = (cmd as unknown as {argv: string[]}).argv
    expect(argv).toEqual([])
  })

  it('case I — --no-input flag 가 있으면 prompt 안 함', async () => {
    setTTY(true)
    const cmd = makeCommandStub(TestCommand, ['--no-input'])
    await (cmd as unknown as {
      maybePromptMissingRequiredFlags(): Promise<void>
    }).maybePromptMissingRequiredFlags()

    const argv = (cmd as unknown as {argv: string[]}).argv
    expect(argv).toEqual(['--no-input'])
  })

  it('NO_INPUT=1 이면 prompt 안 함', async () => {
    setTTY(true)
    process.env.NO_INPUT = '1'
    const cmd = makeCommandStub(TestCommand, [])
    await (cmd as unknown as {
      maybePromptMissingRequiredFlags(): Promise<void>
    }).maybePromptMissingRequiredFlags()

    const argv = (cmd as unknown as {argv: string[]}).argv
    expect(argv).toEqual([])
  })

  it('UNION_CLI_NO_INPUT=1 이면 prompt 안 함', async () => {
    setTTY(true)
    process.env.UNION_CLI_NO_INPUT = '1'
    const cmd = makeCommandStub(TestCommand, [])
    await (cmd as unknown as {
      maybePromptMissingRequiredFlags(): Promise<void>
    }).maybePromptMissingRequiredFlags()

    const argv = (cmd as unknown as {argv: string[]}).argv
    expect(argv).toEqual([])
  })

  it('TTY + 일부만 누락 → 누락된 것만 prompt', async () => {
    setTTY(true)
    mockReadlineAnswer(['us-east-1'])
    const cmd = makeCommandStub(TestCommand, ['--username', 'alice'])
    await (cmd as unknown as {
      maybePromptMissingRequiredFlags(): Promise<void>
    }).maybePromptMissingRequiredFlags()

    const argv = (cmd as unknown as {argv: string[]}).argv
    expect(argv).toEqual(['--username', 'alice', '--region', 'us-east-1'])
  })

  it('required 가 없으면 prompt 안 함', async () => {
    setTTY(true)
    const cmd = makeCommandStub(NoRequiredCommand, [])
    await (cmd as unknown as {
      maybePromptMissingRequiredFlags(): Promise<void>
    }).maybePromptMissingRequiredFlags()

    const argv = (cmd as unknown as {argv: string[]}).argv
    expect(argv).toEqual([])
  })
})

// ── baseFlags 에 --no-input 이 추가됐는지 ──

describe('BaseCommand.baseFlags', () => {
  it('--no-input flag 가 baseFlags 에 정의되어 있다', () => {
    expect(BaseCommand.baseFlags).toHaveProperty('no-input')
  })
})
