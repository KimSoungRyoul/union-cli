import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {Config} from '@oclif/core'
import {join} from 'node:path'
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'

const root = join(import.meta.dirname, '..')

interface CmdResult {
  stdout: string
  stderr: string
  error?: Error
}

/**
 * oclif Config 를 로드하고 completion install 커맨드를 실행, this.log/logToStderr 를 캡처한다.
 */
async function runCmd(args: string[]): Promise<CmdResult> {
  const config = await Config.load({root})
  const stdoutLines: string[] = []
  const stderrLines: string[] = []

  const cmd = await config.findCommand(args[0])
  if (!cmd) throw new Error(`Command not found: ${args[0]}`)

  const instance = await cmd.load()
  const obj = new instance(args.slice(1), config)

  obj.log = (...logArgs: string[]) => {
    stdoutLines.push(logArgs.join(' '))
  }
  obj.logToStderr = (...logArgs: string[]) => {
    stderrLines.push(logArgs.join(' '))
  }

  try {
    await obj.run()
  } catch (e) {
    return {stdout: stdoutLines.join('\n'), stderr: stderrLines.join('\n'), error: e as Error}
  }
  return {stdout: stdoutLines.join('\n'), stderr: stderrLines.join('\n')}
}

describe('completion install', () => {
  let originalHome: string | undefined
  let tmpHome: string

  beforeEach(() => {
    // HOME 을 tmpdir 로 격리하여 --apply 테스트가 사용자 ~/.zshrc 등을 건드리지 않도록.
    originalHome = process.env.HOME
    tmpHome = mkdtempSync(join(tmpdir(), 'completion-test-'))
    process.env.HOME = tmpHome
  })

  // afterEach 가 vi import 없이 동작하도록 globals (vitest config) 활용
  // 실제 cleanup
  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome
    else delete process.env.HOME
    try { rmSync(tmpHome, {recursive: true, force: true}) } catch { /* ignore */ }
  })

  describe('zsh', () => {
    it('zsh completion 안내에 fpath 와 autoload 가 포함된다', async () => {
      const {stdout} = await runCmd(['completion:install', 'zsh'])
      // fpath / autoload 가 안내문 또는 snippet 에 들어있어야 zsh 표준 설치 흐름.
      expect(stdout).toContain('fpath')
      expect(stdout).toContain('autoload')
    })

    it('zsh completion 스크립트에 #compdef 가 포함된다', async () => {
      const {stdout} = await runCmd(['completion:install', 'zsh'])
      expect(stdout).toContain('#compdef')
    })
  })

  describe('bash', () => {
    it('bash completion 안내/스크립트에 complete -F 가 포함된다', async () => {
      const {stdout} = await runCmd(['completion:install', 'bash'])
      expect(stdout).toMatch(/complete -F/)
    })

    it('bash 안내에 .bashrc 또는 bash_completion 경로 안내가 포함된다', async () => {
      const {stdout} = await runCmd(['completion:install', 'bash'])
      const text = stdout
      const hasBashHint = /\.bashrc|bash_completion/.test(text)
      expect(hasBashHint).toBe(true)
    })
  })

  describe('fish', () => {
    it('fish completion 안내에 fish/completions 경로가 포함된다', async () => {
      const {stdout} = await runCmd(['completion:install', 'fish'])
      expect(stdout).toContain('fish/completions')
    })

    it('fish completion 스크립트에 complete -c 가 포함된다', async () => {
      const {stdout} = await runCmd(['completion:install', 'fish'])
      expect(stdout).toMatch(/complete -c/)
    })
  })

  describe('error handling', () => {
    it('알 수 없는 셸이면 에러를 던지거나 exit 1', async () => {
      const {error, stderr} = await runCmd(['completion:install', 'nushell'])
      // oclif this.error() 는 exit 으로 throw 하므로 error 가 있어야 한다.
      const combined = (error?.message ?? '') + stderr
      expect(combined).toMatch(/지원하지 않는 셸|nushell/i)
    })
  })

  describe('auto-detect', () => {
    it('shell 인자 생략 시 SHELL 환경변수로 감지', async () => {
      const originalShell = process.env.SHELL
      process.env.SHELL = '/bin/zsh'
      try {
        const {stdout, stderr} = await runCmd(['completion:install'])
        // 자동 감지 안내 또는 zsh 스크립트가 출력되어야 함
        const combined = stdout + stderr
        expect(combined).toMatch(/zsh|fpath/)
      } finally {
        if (originalShell !== undefined) process.env.SHELL = originalShell
        else delete process.env.SHELL
      }
    })

    it('SHELL 미정 시 기본 zsh 안내 + 안내 메시지', async () => {
      const originalShell = process.env.SHELL
      delete process.env.SHELL
      try {
        const {stdout, stderr} = await runCmd(['completion:install'])
        const combined = stdout + stderr
        expect(combined).toMatch(/zsh/)
      } finally {
        if (originalShell !== undefined) process.env.SHELL = originalShell
      }
    })
  })

  describe('--apply', () => {
    it('--apply --dry-run 은 실제 파일을 만들지 않는다', async () => {
      const {stderr} = await runCmd(['completion:install', 'zsh', '--apply', '--dry-run'])
      const scriptPath = join(tmpHome, '.zfunc', '_union-cli')
      expect(existsSync(scriptPath)).toBe(false)
      expect(stderr).toMatch(/dry-run/)
    })

    it('--apply 는 zsh 스크립트 파일과 ~/.zshrc snippet 을 작성한다', async () => {
      const {stderr} = await runCmd(['completion:install', 'zsh', '--apply'])
      const scriptPath = join(tmpHome, '.zfunc', '_union-cli')
      const rcPath = join(tmpHome, '.zshrc')
      expect(existsSync(scriptPath)).toBe(true)
      const scriptContent = readFileSync(scriptPath, 'utf8')
      expect(scriptContent).toContain('#compdef')
      expect(existsSync(rcPath)).toBe(true)
      const rcContent = readFileSync(rcPath, 'utf8')
      expect(rcContent).toContain('union-cli completion')
      expect(rcContent).toContain('fpath')
      expect(stderr).toMatch(/작성 완료|이미/)
    })

    it('--apply 를 두 번 실행해도 snippet 이 중복 추가되지 않는다', async () => {
      await runCmd(['completion:install', 'zsh', '--apply'])
      await runCmd(['completion:install', 'zsh', '--apply'])
      const rcPath = join(tmpHome, '.zshrc')
      const rcContent = readFileSync(rcPath, 'utf8')
      const occurrences = (rcContent.match(/>>> union-cli completion >>>/g) ?? []).length
      expect(occurrences).toBe(1)
    })

    it('fish --apply 는 ~/.config/fish/completions/<bin>.fish 를 작성한다', async () => {
      await runCmd(['completion:install', 'fish', '--apply'])
      const scriptPath = join(tmpHome, '.config', 'fish', 'completions', 'union-cli.fish')
      expect(existsSync(scriptPath)).toBe(true)
      const content = readFileSync(scriptPath, 'utf8')
      expect(content).toMatch(/complete -c/)
    })
  })
})
