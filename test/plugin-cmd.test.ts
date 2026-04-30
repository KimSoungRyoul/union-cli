import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {Config} from '@oclif/core'
import {join} from 'node:path'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'

const root = join(import.meta.dirname, '..')

/** Helper: load oclif Config and run a built-in command, capturing stdout/stderr. */
async function runCmd(args: string[]): Promise<{stdout: string; stderr: string; exitCode: number}> {
  const config = await Config.load({root})
  const lines: string[] = []
  const stderrLines: string[] = []
  let exitCode = 0

  const cmd = await config.findCommand(args[0])
  if (!cmd) throw new Error(`Command not found: ${args[0]}`)

  const instance = await cmd.load()
  const obj = new instance(args.slice(1), config)

  obj.log = (...logArgs: string[]) => {
    lines.push(logArgs.join(' '))
  }
  obj.logToStderr = (...logArgs: string[]) => {
    stderrLines.push(logArgs.join(' '))
  }

  try {
    await obj.run()
  } catch (err: unknown) {
    // oclif's this.error throws an Error with .oclif and exit code; capture instead of letting test runner surface it
    const e = err as {oclif?: {exit?: number}; message?: string; code?: string}
    if (e.oclif !== undefined || e.code === 'EEXIT') {
      exitCode = (e.oclif?.exit ?? 1) || 1
      stderrLines.push(e.message ?? String(err))
    } else {
      throw err
    }
  }
  return {stdout: lines.join('\n'), stderr: stderrLines.join('\n'), exitCode}
}

const SAMPLE_MANIFEST = `name: sample
namespace: sample
description: "Sample plugin"
provider:
  type: cli
  config:
    binary: echo
commands:
  - id: hello:say
    description: "Say hello"
    cli:
      template: "hello"
`

let tempHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let fixtureDir: string

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'union-cli-plugin-home-'))
  originalHome = process.env.HOME
  originalUserProfile = process.env.USERPROFILE
  process.env.HOME = tempHome
  process.env.USERPROFILE = tempHome

  // Mock npm runner so tests don't hit the real npm
  ;(globalThis as Record<string, unknown>).__unionCliNpmRunner = {
    install: async ({cwd, spec}: {cwd: string; spec: string}) => {
      // Simulate `npm install <spec>`: create node_modules/<spec>/plugins/foo.yaml
      const pkgName = spec.replace(/@[^/@]+$/, '')
      const dir = join(cwd, 'node_modules', pkgName, 'plugins')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'sample.yaml'), SAMPLE_MANIFEST)
    },
    resolvePackagePath: (cwd: string, pkgName: string) => {
      const dir = join(cwd, 'node_modules', pkgName)
      return existsSync(dir) ? dir : null
    },
    packageNameFromSpec: async (_cwd: string, spec: string) => spec.replace(/@[^/@]+$/, ''),
    uninstall: async (cwd: string, pkgName: string) => {
      const dir = join(cwd, 'node_modules', pkgName)
      if (existsSync(dir)) rmSync(dir, {recursive: true, force: true})
    },
  }

  // Build a local plugin fixture
  fixtureDir = mkdtempSync(join(tmpdir(), 'union-cli-plugin-fix-'))
  const pluginsDir = join(fixtureDir, 'plugins')
  mkdirSync(pluginsDir, {recursive: true})
  writeFileSync(join(pluginsDir, 'sample.yaml'), SAMPLE_MANIFEST)
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile

  delete (globalThis as Record<string, unknown>).__unionCliNpmRunner

  rmSync(tempHome, {recursive: true, force: true})
  if (existsSync(fixtureDir)) rmSync(fixtureDir, {recursive: true, force: true})
})

describe('plugin commands', () => {
  describe('plugin add (local path)', () => {
    it('로컬 디렉토리를 추가하면 registry에 plugins/*.yaml이 등록된다', async () => {
      const {stdout, exitCode} = await runCmd(['plugin:add', fixtureDir])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('플러그인 추가')
      expect(stdout).toContain('source: file')
      expect(stdout).toContain('매니페스트: 1개')

      // Registry file is created at ~/.<bin>/plugins.json
      // The CLI bin name comes from package.json/oclif config (union-cli)
      const regPath = join(tempHome, '.union-cli', 'plugins.json')
      expect(existsSync(regPath)).toBe(true)

      const reg = JSON.parse(readFileSync(regPath, 'utf-8'))
      expect(reg.version).toBe(1)
      expect(reg.plugins).toHaveLength(1)
      expect(reg.plugins[0].source).toBe('file')
      expect(reg.plugins[0].manifestPaths[0]).toContain('sample.yaml')
    })

    it('registry 파일은 0600 권한으로 저장된다', async () => {
      await runCmd(['plugin:add', fixtureDir])
      const regPath = join(tempHome, '.union-cli', 'plugins.json')
      const stat = statSync(regPath)
      expect(stat.mode & 0o777).toBe(0o600)
    })
  })

  describe('plugin list', () => {
    it('등록된 플러그인이 없으면 안내 메시지를 출력한다', async () => {
      const {stdout} = await runCmd(['plugin:list'])
      expect(stdout).toContain('등록된 플러그인이 없습니다')
    })

    it('--json 플래그는 registry plugins 배열을 출력한다', async () => {
      // First add a plugin
      await runCmd(['plugin:add', fixtureDir])
      const {stdout} = await runCmd(['plugin:list', '--json'])
      const parsed = JSON.parse(stdout)
      expect(parsed.plugins).toHaveLength(1)
      expect(parsed.plugins[0].source).toBe('file')
    })

    it('테이블 헤더와 함께 등록된 플러그인을 출력한다', async () => {
      await runCmd(['plugin:add', fixtureDir])
      const {stdout} = await runCmd(['plugin:list'])
      expect(stdout).toContain('NAME')
      expect(stdout).toContain('SOURCE')
      expect(stdout).toContain('MANIFESTS')
      expect(stdout).toContain('INSTALLED')
      expect(stdout).toContain('file')
    })
  })

  describe('plugin remove', () => {
    it('등록된 플러그인을 제거하면 registry에서 삭제된다', async () => {
      const addResult = await runCmd(['plugin:add', fixtureDir])
      // Extract registered name from registry (it's the absolute path for file source)
      const regPath = join(tempHome, '.union-cli', 'plugins.json')
      const reg = JSON.parse(readFileSync(regPath, 'utf-8'))
      const name = reg.plugins[0].name
      expect(addResult.exitCode).toBe(0)

      const {stdout, exitCode} = await runCmd(['plugin:remove', name])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('플러그인 제거')

      const reg2 = JSON.parse(readFileSync(regPath, 'utf-8'))
      expect(reg2.plugins).toHaveLength(0)
    })

    it('존재하지 않는 플러그인을 제거하면 에러를 반환한다', async () => {
      const {stderr, exitCode} = await runCmd(['plugin:remove', 'nonexistent-plugin'])
      expect(exitCode).not.toBe(0)
      expect(stderr).toContain('등록된 플러그인이 아닙니다')
    })
  })

  describe('plugin add (npm package — mocked)', () => {
    it('npm 패키지 추가 시 mock npm이 호출되고 registry에 기록된다', async () => {
      const {stdout, exitCode} = await runCmd(['plugin:add', '@team/foo-plugin'])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('source: npm')

      const regPath = join(tempHome, '.union-cli', 'plugins.json')
      const reg = JSON.parse(readFileSync(regPath, 'utf-8'))
      expect(reg.plugins).toHaveLength(1)
      expect(reg.plugins[0].name).toBe('@team/foo-plugin')
      expect(reg.plugins[0].source).toBe('npm')
    })
  })

  describe('plugin add (잘못된 source)', () => {
    it('존재하지 않는 로컬 경로를 추가하면 에러를 반환한다', async () => {
      const {stderr, exitCode} = await runCmd(['plugin:add', './does-not-exist-anywhere-xyz'])
      expect(exitCode).not.toBe(0)
      expect(stderr).toContain('경로를 찾을 수 없습니다')
    })
  })
})
