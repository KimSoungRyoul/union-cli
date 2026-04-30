import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'

// ── child_process.spawn mock ──
//
// 모든 케이스에서 실제 less 가 떠선 안 됨. 모듈 단위로 mock.
const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

import {writeWithPager, shouldUsePager} from '../src/core/pager.js'

// ── 테스트용 fake child_process ──

interface FakeChild extends EventEmitter {
  stdin: PassThrough & {
    writtenChunks: string[]
    endCalled: boolean
  }
  __close(code?: number): void
  __error(err: NodeJS.ErrnoException): void
}

function makeFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild
  const stdin = new PassThrough() as PassThrough & {
    writtenChunks: string[]
    endCalled: boolean
  }
  stdin.writtenChunks = []
  stdin.endCalled = false

  const origEnd = stdin.end.bind(stdin)
  stdin.end = (chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string') stdin.writtenChunks.push(chunk)
    stdin.endCalled = true
    // queue close after end()
    return origEnd(chunk as never, ...(rest as []))
  }

  ee.stdin = stdin
  ee.__close = (code = 0) => ee.emit('close', code)
  ee.__error = (err) => ee.emit('error', err)
  return ee
}

// ── 공통 process state 백업 ──

const origEnv = {...process.env}
const origIsTTY = process.stdout.isTTY
const origRows = process.stdout.rows
const origWrite = process.stdout.write

beforeEach(() => {
  spawnMock.mockReset()
  process.env = {...origEnv}
  delete process.env.PAGER
  delete process.env.NO_PAGER
})

afterEach(() => {
  process.env = {...origEnv}
  Object.defineProperty(process.stdout, 'isTTY', {
    value: origIsTTY,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(process.stdout, 'rows', {
    value: origRows,
    configurable: true,
    writable: true,
  })
  process.stdout.write = origWrite
  vi.restoreAllMocks()
})

function setTTY(isTTY: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', {
    value: isTTY,
    configurable: true,
    writable: true,
  })
}

function setRows(rows: number) {
  Object.defineProperty(process.stdout, 'rows', {
    value: rows,
    configurable: true,
    writable: true,
  })
}

function captureStdout(): {writes: string[]; restore: () => void} {
  const writes: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  ;(process.stdout as unknown as {write: (s: string) => boolean}).write = (
    chunk: string,
  ) => {
    writes.push(typeof chunk === 'string' ? chunk : String(chunk))
    return true
  }
  return {
    writes,
    restore: () => {
      process.stdout.write = orig
    },
  }
}

const longText = Array.from({length: 200}, (_, i) => `line ${i}`).join('\n')
const shortText = 'one\ntwo\nthree\n'

// ── shouldUsePager ──

describe('shouldUsePager', () => {
  it('non-TTY 면 false', () => {
    setTTY(false)
    expect(shouldUsePager()).toBe(false)
  })

  it('TTY + 기본 옵션이면 true', () => {
    setTTY(true)
    expect(shouldUsePager()).toBe(true)
  })

  it('opts.enabled === false 면 false', () => {
    setTTY(true)
    expect(shouldUsePager({enabled: false})).toBe(false)
  })

  it('NO_PAGER=1 이면 false', () => {
    setTTY(true)
    process.env.NO_PAGER = '1'
    expect(shouldUsePager()).toBe(false)
  })

  it("PAGER='' 이면 false", () => {
    setTTY(true)
    process.env.PAGER = ''
    expect(shouldUsePager()).toBe(false)
  })
})

// ── writeWithPager ──

describe('writeWithPager — case A: non-TTY', () => {
  it('non-TTY 면 spawn 호출 없이 stdout 으로 직접 출력한다', async () => {
    setTTY(false)
    const cap = captureStdout()
    try {
      await writeWithPager(longText)
    } finally {
      cap.restore()
    }
    expect(spawnMock).not.toHaveBeenCalled()
    expect(cap.writes.join('')).toBe(longText)
  })
})

describe('writeWithPager — case B: text 가 threshold 미만', () => {
  it('짧은 텍스트면 pager 안 쓰고 stdout 으로 출력한다', async () => {
    setTTY(true)
    setRows(50)
    const cap = captureStdout()
    try {
      await writeWithPager(shortText)
    } finally {
      cap.restore()
    }
    expect(spawnMock).not.toHaveBeenCalled()
    expect(cap.writes.join('')).toBe(shortText)
  })
})

describe('writeWithPager — case C: TTY + 긴 text', () => {
  it('pager 를 spawn 하고 text 를 stdin 으로 보낸다', async () => {
    setTTY(true)
    setRows(10)
    const fake = makeFakeChild()
    spawnMock.mockReturnValueOnce(fake)

    const promise = writeWithPager(longText)

    // pager 정상 종료 simulate
    setTimeout(() => fake.__close(0), 0)
    await promise

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const callArgs = spawnMock.mock.calls[0]
    // 기본은 less -R
    expect(callArgs[0]).toBe('less')
    expect(callArgs[1]).toEqual(['-R'])
    expect(fake.stdin.endCalled).toBe(true)
    expect(fake.stdin.writtenChunks.join('')).toBe(longText)
  })

  it('PAGER env 가 있으면 그 명령을 사용한다', async () => {
    setTTY(true)
    setRows(10)
    process.env.PAGER = 'more -F'

    const fake = makeFakeChild()
    spawnMock.mockReturnValueOnce(fake)

    const promise = writeWithPager(longText)
    setTimeout(() => fake.__close(0), 0)
    await promise

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0][0]).toBe('more')
    expect(spawnMock.mock.calls[0][1]).toEqual(['-F'])
  })
})

describe('writeWithPager — case D: opts.enabled=false', () => {
  it('enabled=false 면 spawn 우회, stdout 사용', async () => {
    setTTY(true)
    setRows(10)
    const cap = captureStdout()
    try {
      await writeWithPager(longText, {enabled: false})
    } finally {
      cap.restore()
    }
    expect(spawnMock).not.toHaveBeenCalled()
    expect(cap.writes.join('')).toBe(longText)
  })
})

describe('writeWithPager — case E: PAGER 빈 문자열 / NO_PAGER', () => {
  it("PAGER='' 이면 spawn 우회", async () => {
    setTTY(true)
    setRows(10)
    process.env.PAGER = ''
    const cap = captureStdout()
    try {
      await writeWithPager(longText)
    } finally {
      cap.restore()
    }
    expect(spawnMock).not.toHaveBeenCalled()
    expect(cap.writes.join('')).toBe(longText)
  })

  it('NO_PAGER=1 이면 spawn 우회', async () => {
    setTTY(true)
    setRows(10)
    process.env.NO_PAGER = '1'
    const cap = captureStdout()
    try {
      await writeWithPager(longText)
    } finally {
      cap.restore()
    }
    expect(spawnMock).not.toHaveBeenCalled()
    expect(cap.writes.join('')).toBe(longText)
  })
})

describe('writeWithPager — case F: 잘못된 PAGER 명령', () => {
  it('spawn 이 ENOENT 에러를 내면 stdout fallback', async () => {
    setTTY(true)
    setRows(10)
    process.env.PAGER = 'definitely-not-a-real-pager-xyz'

    const fake = makeFakeChild()
    spawnMock.mockReturnValueOnce(fake)

    const cap = captureStdout()
    const promise = writeWithPager(longText)
    // emit ENOENT
    const enoent: NodeJS.ErrnoException = Object.assign(
      new Error('spawn ENOENT'),
      {code: 'ENOENT'},
    )
    setTimeout(() => fake.__error(enoent), 0)
    await promise
    cap.restore()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    // fallback 으로 stdout 에 기록되어야 함
    expect(cap.writes.join('')).toBe(longText)
  })

  it('spawn 자체가 throw 해도 stdout fallback', async () => {
    setTTY(true)
    setRows(10)
    spawnMock.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    const cap = captureStdout()
    await writeWithPager(longText)
    cap.restore()

    expect(cap.writes.join('')).toBe(longText)
  })
})

describe('writeWithPager — SIGPIPE', () => {
  it('stdin EPIPE 는 무시되고 정상 종료한다', async () => {
    setTTY(true)
    setRows(10)
    const fake = makeFakeChild()
    spawnMock.mockReturnValueOnce(fake)

    const promise = writeWithPager(longText)

    // pager 가 먼저 q 로 종료한 척: stdin EPIPE → close
    setTimeout(() => {
      const epipe: NodeJS.ErrnoException = Object.assign(
        new Error('write EPIPE'),
        {code: 'EPIPE'},
      )
      fake.stdin.emit('error', epipe)
      fake.__close(0)
    }, 0)

    await expect(promise).resolves.toBeUndefined()
  })
})
