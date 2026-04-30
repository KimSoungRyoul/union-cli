/**
 * test/e2e/helpers.ts
 *
 * E2E spawn helper for union-cli.
 *
 * Strategy:
 *   - Use ./bin/dev.js (tsx) to avoid a hard dependency on `npm run build`.
 *   - Each test spawns a fresh node process and captures stdout/stderr/exitCode.
 *   - Tests that need an initialized Executor (e.g. `auth status`) can pass
 *     `cwd` pointing to a tmp dir prepared via {@link prepareCwdWithManifest}.
 */
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {dirname, join, resolve} from 'node:path'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'

// ------- paths ----------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
/** Absolute path to the project root (worktree). */
export const PROJECT_ROOT = resolve(HERE, '..', '..')
/** Absolute path to ./bin/dev.js — tsx-based entry, no `npm run build` required. */
export const DEV_BIN = join(PROJECT_ROOT, 'bin', 'dev.js')
/** Absolute path to ./bin/run.js — built dist entry; only usable after `npm run build`. */
export const RUN_BIN = join(PROJECT_ROOT, 'bin', 'run.js')

// ------- types ----------------------------------------------------------------

export interface RunResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** Convenience: combined stdout + stderr (handy for help/error matching). */
  combined: string
}

export interface RunOptions {
  /** Extra env variables (merged onto process.env minus FORCE_COLOR/CI noise). */
  env?: NodeJS.ProcessEnv
  /** Working directory. Default = PROJECT_ROOT. */
  cwd?: string
  /** stdin payload (string). */
  input?: string
  /** Hard timeout in ms. Default = 30_000. */
  timeout?: number
  /** Use ./bin/run.js (built dist) instead of dev.js. Default = false. */
  useBuilt?: boolean
}

// ------- spawn ----------------------------------------------------------------

/**
 * Spawn the union-cli entry script and resolve once it exits.
 *
 * Notes:
 *   - We deliberately scrub `FORCE_COLOR` / set `NO_COLOR=1` by default so ANSI
 *     escapes don't bleed into snapshots. Individual tests can opt back in via
 *     `opts.env`.
 */
export async function runCli(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const bin = opts.useBuilt ? RUN_BIN : DEV_BIN
  const cwd = opts.cwd ?? PROJECT_ROOT
  const timeout = opts.timeout ?? 30_000

  // Inherit minimal env. Drop CI/FORCE_COLOR so output is deterministic; tests
  // that want color can re-enable it via opts.env.
  const baseEnv: NodeJS.ProcessEnv = {...process.env}
  delete baseEnv.FORCE_COLOR
  delete baseEnv.CI
  // Default to NO_COLOR so chalk/oclif default to plain text in snapshots.
  if (baseEnv.NO_COLOR === undefined) baseEnv.NO_COLOR = '1'

  // Merge user env. A user value of `undefined` means "remove this var" —
  // useful for tests that want to flip color back on.
  const env: NodeJS.ProcessEnv = {...baseEnv}
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }

  return new Promise<RunResult>((resolveResult, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const killTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeout)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    if (opts.input !== undefined) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()

    child.on('error', error => {
      clearTimeout(killTimer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(killTimer)
      if (timedOut) {
        reject(new Error(
          `runCli timed out after ${timeout}ms — args=${JSON.stringify(args)}\n` +
          `stdout:\n${stdout}\nstderr:\n${stderr}`,
        ))
        return
      }
      resolveResult({
        exitCode: code,
        signal,
        stdout,
        stderr,
        combined: stdout + stderr,
      })
    })
  })
}

// ------- tmp cwd helpers ------------------------------------------------------

/** ANSI-escape regex (covers SGR + most CSI sequences). */
// eslint-disable-next-line no-control-regex
export const ANSI_RE = /\[[0-?]*[ -/]*[@-~]/g

/** Strip ANSI escape codes — handy for assertions on color-free output. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** True iff `s` contains any ANSI escape sequence. Resets the regex's lastIndex. */
export function hasAnsi(s: string): boolean {
  ANSI_RE.lastIndex = 0
  return ANSI_RE.test(s)
}

export interface TempCwd {
  cwd: string
  cleanup(): void
}

/**
 * Make an isolated cwd with `.union-cli/manifest.json` pre-populated.
 *
 * The init hook (src/hooks/init.ts) only registers the global executor when
 * a manifest cache exists, so commands like `auth status` need this in order
 * to run at all (otherwise they throw "Executor not initialized").
 *
 * Pass `manifests = []` to init the executor with zero providers.
 */
export function prepareCwdWithManifest(
  manifests: unknown[] = [],
): TempCwd {
  const dir = mkdtempSync(join(tmpdir(), 'union-cli-e2e-'))
  const cacheDir = join(dir, '.union-cli')
  mkdirSync(cacheDir, {recursive: true})
  writeFileSync(join(cacheDir, 'manifest.json'), JSON.stringify(manifests, null, 2))
  return {
    cwd: dir,
    cleanup: () => {
      rmSync(dir, {recursive: true, force: true})
    },
  }
}
