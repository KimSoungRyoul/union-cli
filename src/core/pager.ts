import {spawn} from 'node:child_process'

/**
 * 옵션:
 * - enabled    : 명시적 ON/OFF (예: --no-pager → false). 기본 자동.
 * - pagerCmd   : 기본 PAGER env, 그 외 'less -R'. 빈 문자열이면 비활성화.
 * - thresholdLines : 출력 줄 수가 이 값보다 클 때만 pager 사용.
 *                   기본 process.stdout.rows (없으면 24).
 */
export interface PagerOptions {
  enabled?: boolean
  pagerCmd?: string
  thresholdLines?: number
}

const DEFAULT_THRESHOLD_FALLBACK = 24

/** 줄 수 카운트 (마지막 빈 줄도 안전히 처리) */
function countLines(text: string): number {
  if (text.length === 0) return 0
  // 한 줄짜리 + 개행 없음 = 1
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) n++
  }
  // 마지막이 \n으로 끝나면 trailing empty line 1줄 추가는 의도와 안 맞으니 그대로 유지
  return n
}

/** PAGER 환경변수 / 기본값 → ['cmd', ...args] 로 토큰화 */
function resolvePagerCmd(opts?: PagerOptions): string[] | null {
  // explicit empty string in pagerCmd → opt-out
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'pagerCmd')) {
    const v = opts.pagerCmd
    if (v === undefined) {
      // fallthrough to env handling
    } else if (v === '' || v.trim() === '') {
      return null
    } else {
      return v.trim().split(/\s+/)
    }
  }

  const fromEnv = process.env.PAGER
  if (fromEnv !== undefined) {
    if (fromEnv === '' || fromEnv.trim() === '') return null
    return fromEnv.trim().split(/\s+/)
  }

  return ['less', '-R']
}

/** pager 활성화 여부 결정 */
export function shouldUsePager(opts?: PagerOptions): boolean {
  if (opts?.enabled === false) return false
  if (process.env.NO_PAGER !== undefined && process.env.NO_PAGER !== '') return false
  if (process.env.PAGER === '') return false
  if (!process.stdout.isTTY) return false
  return true
}

/** 줄 수 기반 추가 판정. shouldUsePager() 통과한 뒤에만 호출. */
function exceedsThreshold(text: string, opts?: PagerOptions): boolean {
  const threshold =
    opts?.thresholdLines ??
    (typeof process.stdout.rows === 'number' && process.stdout.rows > 0
      ? process.stdout.rows
      : DEFAULT_THRESHOLD_FALLBACK)
  return countLines(text) > threshold
}

/**
 * TTY 환경에서 출력이 길면 pager 로 파이프, 아니면 stdout 직접.
 * pager 명령 자체가 실패하면 stdout 으로 fallback.
 */
export async function writeWithPager(
  text: string,
  opts?: PagerOptions,
): Promise<void> {
  if (!shouldUsePager(opts)) {
    process.stdout.write(text)
    return
  }
  if (!exceedsThreshold(text, opts)) {
    process.stdout.write(text)
    return
  }

  const cmd = resolvePagerCmd(opts)
  if (!cmd || cmd.length === 0) {
    process.stdout.write(text)
    return
  }

  const [bin, ...args] = cmd

  await new Promise<void>((resolve) => {
    let resolved = false
    const finishOnce = () => {
      if (resolved) return
      resolved = true
      resolve()
    }
    const fallback = () => {
      if (resolved) return
      resolved = true
      try {
        process.stdout.write(text)
      } catch {
        // ignore
      }
      resolve()
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, {
        stdio: ['pipe', 'inherit', 'inherit'],
      })
    } catch {
      fallback()
      return
    }

    // pager 종료 직후 닫힘 → SIGPIPE 방지
    if (child.stdin) {
      child.stdin.on('error', (err: NodeJS.ErrnoException) => {
        // EPIPE: pager 가 먼저 종료한 경우 (q). 정상 처리.
        if (err.code === 'EPIPE') return
        // 그 외 stdin 에러: fallback
        fallback()
      })
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      // ENOENT 등 → pager 자체가 없음 → stdout fallback
      if (err.code === 'ENOENT' || err.code === 'EACCES') {
        fallback()
        return
      }
      fallback()
    })

    child.on('close', () => {
      finishOnce()
    })

    // text 쓰기. pager 가 먼저 종료해도 EPIPE 핸들러가 흡수.
    try {
      if (child.stdin) {
        child.stdin.end(text)
      }
    } catch {
      fallback()
    }
  })
}
