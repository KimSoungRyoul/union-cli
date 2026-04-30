import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {EventEmitter} from 'node:events'
import type {Interface as ReadlineInterface} from 'node:readline'

import {prompt, promptMany, isNoInput} from '../src/core/prompt.js'

// readline 모듈 자체를 mock — ESM 에서는 spyOn 이 동작하지 않으므로.
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

// ── isNoInput ──

describe('isNoInput', () => {
  it('non-TTY 면 true 를 반환한다', () => {
    setTTY(false)
    expect(isNoInput()).toBe(true)
  })

  it('TTY 이고 env 변수가 없으면 false', () => {
    setTTY(true)
    expect(isNoInput()).toBe(false)
  })

  it('NO_INPUT=1 이면 true', () => {
    setTTY(true)
    process.env.NO_INPUT = '1'
    expect(isNoInput()).toBe(true)
  })

  it('UNION_CLI_NO_INPUT=1 이면 true', () => {
    setTTY(true)
    process.env.UNION_CLI_NO_INPUT = '1'
    expect(isNoInput()).toBe(true)
  })

  it('NO_INPUT=0 이면 false (opt-out 해제)', () => {
    setTTY(true)
    process.env.NO_INPUT = '0'
    expect(isNoInput()).toBe(false)
  })

  it('NO_INPUT="" 면 false (빈 문자열은 unset 으로 간주)', () => {
    setTTY(true)
    process.env.NO_INPUT = ''
    expect(isNoInput()).toBe(false)
  })
})

// ── prompt: 기본 동작 ──

describe('prompt', () => {
  it('case A — TTY + 정상 입력 → 입력값을 반환한다', async () => {
    setTTY(true)
    mockReadlineAnswer(['hello'])
    const result = await prompt({message: 'Name'})
    expect(result).toBe('hello')
  })

  it('case B — non-TTY 면 throw 한다 ("non-interactive environment")', async () => {
    setTTY(false)
    await expect(prompt({message: 'Name'})).rejects.toThrow(/non-interactive environment/i)
  })

  it('case C — NO_INPUT=1 이면 throw 한다', async () => {
    setTTY(true)
    process.env.NO_INPUT = '1'
    await expect(prompt({message: 'Name'})).rejects.toThrow(/non-interactive environment/i)
  })

  it('case C-2 — UNION_CLI_NO_INPUT=1 이면 throw 한다', async () => {
    setTTY(true)
    process.env.UNION_CLI_NO_INPUT = '1'
    await expect(prompt({message: 'Name'})).rejects.toThrow(/non-interactive environment/i)
  })

  it('case D — default 값 설정 + 빈 입력 → default 반환', async () => {
    setTTY(true)
    mockReadlineAnswer([''])
    const result = await prompt({message: 'Name', default: 'anonymous'})
    expect(result).toBe('anonymous')
  })

  it('case D-2 — default 값 무시되고 입력값이 우선', async () => {
    setTTY(true)
    mockReadlineAnswer(['custom'])
    const result = await prompt({message: 'Name', default: 'anonymous'})
    expect(result).toBe('custom')
  })

  it('case E — validate 실패 → 재입력 (성공 시 반환)', async () => {
    setTTY(true)
    // 첫 입력 "" → fail, 둘째 "valid" → ok
    mockReadlineAnswer(['', 'valid'])
    const result = await prompt({
      message: 'Name',
      validate: input => (input === '' ? 'cannot be empty' : true),
    })
    expect(result).toBe('valid')
  })

  it('case E-2 — validate 가 3 회 모두 실패하면 throw', async () => {
    setTTY(true)
    mockReadlineAnswer(['', '', ''])
    await expect(
      prompt({
        message: 'Name',
        validate: () => 'always fails',
      }),
    ).rejects.toThrow(/validation failed/i)
  })

  it('case F — hidden: true 인 경우, raw mode 가 호출된다', async () => {
    setTTY(true)
    // setRawMode 이 존재하지 않으면 hidden mode 가 reject 하므로,
    // 존재하지만 raw 모드 진입 후 곧바로 enter 를 emit 하는 fake 를 구성.
    const setRawMode = vi.fn()
    const stdinAny = process.stdin as unknown as {
      setRawMode?: (v: boolean) => void
      isRaw?: boolean
    }
    const origSetRaw = stdinAny.setRawMode
    const origIsRaw = stdinAny.isRaw
    stdinAny.setRawMode = setRawMode as unknown as typeof origSetRaw
    stdinAny.isRaw = false

    // data 이벤트로 입력 시뮬레이트: "secret" + Enter
    const stdinEmitter = process.stdin as unknown as EventEmitter
    setImmediate(() => {
      stdinEmitter.emit('data', 'secret\n')
    })

    try {
      const result = await prompt({message: 'Password', hidden: true})
      expect(result).toBe('secret')
      // raw mode 가 적어도 한 번 켜지고 (true) 이후 복원 호출이 있어야 함
      expect(setRawMode).toHaveBeenCalledWith(true)
      // 복원 호출 (다시 false 또는 wasRaw 값으로)
      expect(setRawMode.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      stdinAny.setRawMode = origSetRaw
      stdinAny.isRaw = origIsRaw
    }
  })
})

// ── promptMany ──

describe('promptMany', () => {
  it('여러 prompt 를 순차 실행하고 name 을 키로 반환한다', async () => {
    setTTY(true)
    mockReadlineAnswer(['alice', 'engineer'])
    const result = await promptMany([
      {name: 'username', message: 'Username'},
      {name: 'role', message: 'Role'},
    ])
    expect(result).toEqual({username: 'alice', role: 'engineer'})
  })

  it('name 미지정 시 message 를 키로 사용', async () => {
    setTTY(true)
    mockReadlineAnswer(['x'])
    const result = await promptMany([{message: 'Hostname'}])
    expect(result).toEqual({Hostname: 'x'})
  })
})
