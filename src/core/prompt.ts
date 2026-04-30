/**
 * Zero-dep readline-based interactive prompt.
 *
 * 디자인 원칙:
 * - non-TTY 환경에서는 즉시 throw (CI, 파이프라인 안전성)
 * - NO_INPUT / UNION_CLI_NO_INPUT 환경변수로 opt-out 가능 (clig.dev "Discoverability")
 * - hidden 모드는 stdin raw mode 로 echo 비활성 (password 등)
 * - validate 실패 시 재입력 (최대 3회, 이후 throw)
 * - 외부 의존성 없음 (node:readline 만 사용)
 */
import {createInterface, Interface as ReadlineInterface} from 'node:readline'

export interface PromptOptions {
  /** 프롬프트 메시지 (예: "Enter username") */
  message: string
  /** 빈 입력 시 사용할 기본값 */
  default?: string
  /** true 면 입력값을 화면에 표시하지 않음 (password) */
  hidden?: boolean
  /**
   * 입력값 검증.
   * - true 반환 시 통과
   * - 문자열 반환 시 에러 메시지로 사용 (재프롬프트)
   */
  validate?: (input: string) => true | string
  /** ms 단위 타임아웃 (지정 시, 시간 초과되면 throw) */
  timeout?: number
  /** 식별자 (promptMany 의 결과 키) — 단일 prompt 에서는 무시됨 */
  name?: string
}

const MAX_RETRIES = 3

/**
 * non-TTY 또는 NO_INPUT/UNION_CLI_NO_INPUT 환경에서는 true.
 * 이때는 prompt() 호출이 throw 한다.
 */
export function isNoInput(): boolean {
  if (process.env.NO_INPUT !== undefined && process.env.NO_INPUT !== '0' && process.env.NO_INPUT !== '') {
    return true
  }
  if (
    process.env.UNION_CLI_NO_INPUT !== undefined &&
    process.env.UNION_CLI_NO_INPUT !== '0' &&
    process.env.UNION_CLI_NO_INPUT !== ''
  ) {
    return true
  }
  if (!process.stdin.isTTY) return true
  return false
}

/**
 * TTY 환경에서 사용자 입력을 받는다.
 * non-TTY 또는 NO_INPUT 면 throw.
 */
export async function prompt(opts: PromptOptions): Promise<string> {
  if (isNoInput()) {
    throw new Error(
      `non-interactive environment: cannot prompt for "${opts.message}". ` +
        `Provide the value via flag/argument, or unset NO_INPUT/UNION_CLI_NO_INPUT.`,
    )
  }

  const renderMessage = (): string => {
    const def = opts.default ? ` (${opts.default})` : ''
    return `${opts.message}${def}: `
  }

  let attempt = 0
  // 최대 MAX_RETRIES 회 재시도
  while (attempt < MAX_RETRIES) {
    attempt++
    const raw = opts.hidden
      ? await readHidden(renderMessage(), opts.timeout)
      : await readVisible(renderMessage(), opts.timeout)
    const value = raw === '' && opts.default !== undefined ? opts.default : raw
    if (opts.validate) {
      const result = opts.validate(value)
      if (result === true) return value
      // 에러 메시지 출력 후 재시도
      process.stderr.write(`  ${typeof result === 'string' ? result : 'invalid input'}\n`)
      continue
    }
    return value
  }
  throw new Error(`prompt validation failed after ${MAX_RETRIES} attempts: ${opts.message}`)
}

/**
 * 여러 prompt 를 순차 실행.
 * 각 항목의 name (없으면 message) 을 키로 결과 객체를 반환.
 */
export async function promptMany(opts: PromptOptions[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const o of opts) {
    const key = o.name ?? o.message
    result[key] = await prompt(o)
  }
  return result
}

// ── 내부: 일반(visible) 입력 ──

function readVisible(question: string, timeoutMs?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const rl: ReadlineInterface = createInterface({input: process.stdin, output: process.stderr})
    let timer: NodeJS.Timeout | undefined
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      try {
        rl.close()
      } catch {
        // noop
      }
    }
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup()
        reject(new Error(`prompt timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }
    rl.question(question, answer => {
      cleanup()
      resolve(answer.trim())
    })
  })
}

// ── 내부: hidden 입력 (password) ──
// stdin raw mode 로 직접 char 읽기. echo 안 함.

function readHidden(question: string, timeoutMs?: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    process.stderr.write(question)
    const stdin = process.stdin

    // setRawMode 은 TTY 일 때만 존재
    const supportsRaw = typeof stdin.setRawMode === 'function'
    if (!supportsRaw) {
      reject(new Error('hidden prompt requires TTY raw mode support'))
      return
    }

    let buf = ''
    const wasRaw = stdin.isRaw ?? false
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let timer: NodeJS.Timeout | undefined
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      stdin.removeListener('data', onData)
      try {
        stdin.setRawMode(wasRaw)
      } catch {
        // noop
      }
      stdin.pause()
      process.stderr.write('\n')
    }

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0)
        if (ch === '\n' || ch === '\r' || code === 4) {
          // Enter 또는 Ctrl-D
          cleanup()
          resolve(buf)
          return
        }
        if (code === 3) {
          // Ctrl-C
          cleanup()
          reject(new Error('prompt cancelled (Ctrl-C)'))
          return
        }
        if (code === 8 || code === 127) {
          // Backspace / DEL
          buf = buf.slice(0, -1)
          continue
        }
        buf += ch
      }
    }

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup()
        reject(new Error(`prompt timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }
    stdin.on('data', onData)
  })
}
