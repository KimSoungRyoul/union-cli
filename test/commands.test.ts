import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {Config} from '@oclif/core'
import {join} from 'node:path'
import {mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs'

const root = join(import.meta.dirname, '..')

/**
 * Helper: oclif Config를 로드하고 커맨드를 실행, this.log() 출력을 캡처
 */
async function runCmd(args: string[]): Promise<{stdout: string; stderr: string}> {
  const config = await Config.load({root})
  const lines: string[] = []
  const stderrLines: string[] = []

  const cmd = await config.findCommand(args[0])
  if (!cmd) throw new Error(`Command not found: ${args[0]}`)

  const instance = await cmd.load()
  const obj = new instance(args.slice(1), config)

  // this.log() 가 호출하는 process.stdout.write를 캡처
  obj.log = (...logArgs: string[]) => {
    lines.push(logArgs.join(' '))
  }
  obj.logToStderr = (...logArgs: string[]) => {
    stderrLines.push(logArgs.join(' '))
  }

  await obj.run()
  return {stdout: lines.join('\n'), stderr: stderrLines.join('\n')}
}

/** Set up a mock executor on globalThis for auth command tests */
function setupMockExecutor(manifests: Array<{
  namespace: string
  name?: string
  description?: string
  authType?: string
  authServiceName?: string
  baseUrl?: string
}>) {
  const pluginManifests = manifests.map(m => ({
    name: m.name ?? m.namespace,
    namespace: m.namespace,
    description: m.description ?? `${m.namespace} provider`,
    provider: {
      type: 'http' as const,
      config: {
        baseUrl: m.baseUrl ?? 'http://localhost:8080',
        auth: {
          type: m.authType ?? 'none',
          serviceName: m.authServiceName ?? m.namespace,
        },
      },
    },
    commands: [],
  }))

  const registry = {
    getAllManifests: () => pluginManifests,
  }
  ;(globalThis as Record<string, unknown>).__unionCliExecutor = {registry}
}

function teardownMockExecutor() {
  delete (globalThis as Record<string, unknown>).__unionCliExecutor
}

describe('Built-in Commands', () => {
  describe('doctor', () => {
    it('시스템 상태를 출력한다', async () => {
      const {stdout, stderr} = await runCmd(['doctor'])
      const combined = stdout + stderr
      expect(combined).toContain('Node.js')
      expect(combined).toContain('시스템 상태')
    })

    it('--json 플래그로 JSON 출력한다', async () => {
      const {stdout} = await runCmd(['doctor', '--json'])
      const parsed = JSON.parse(stdout)
      expect(parsed.node.status).toBe('ok')
      expect(parsed.node.version).toMatch(/^v\d+/)
      expect(parsed.cwd.status).toBe('ok')
    })
  })

  describe('auth login', () => {
    beforeEach(() => {
      setupMockExecutor([
        {namespace: 'test-svc', authType: 'none'},
        {namespace: 'my-provider', authType: 'none'},
      ])
    })
    afterEach(teardownMockExecutor)

    it('namespace 없이 실행하면 전체 로그인을 시도한다', async () => {
      const {stderr} = await runCmd(['auth:login', '--no-color'])
      // With 'none' auth type, it should skip with "인증 불필요" message
      expect(stderr).toContain('test-svc')
      expect(stderr).toContain('인증 불필요')
    })

    it('namespace를 지정하면 해당 provider 로그인을 시도한다', async () => {
      const {stderr} = await runCmd(['auth:login', 'my-provider', '--no-color'])
      expect(stderr).toContain('my-provider')
    })
  })

  describe('auth status', () => {
    beforeEach(() => {
      setupMockExecutor([
        {namespace: 'test-svc', authType: 'none'},
      ])
    })
    afterEach(teardownMockExecutor)

    it('상태 테이블 헤더를 출력한다', async () => {
      const {stdout} = await runCmd(['auth:status'])
      expect(stdout).toContain('NAMESPACE')
      expect(stdout).toContain('STATUS')
    })
  })

  describe('auth logout', () => {
    beforeEach(() => {
      setupMockExecutor([
        {namespace: 'my-ns', authType: 'cookie', authServiceName: 'my-ns'},
      ])
    })
    afterEach(() => {
      teardownMockExecutor()
      // Clean up any created tokens
      const tokensDir = join(process.cwd(), '.union-cli')
      const tokensPath = join(tokensDir, 'tokens.json')
      if (existsSync(tokensPath)) {
        rmSync(tokensPath)
      }
    })

    it('namespace 없이 실행하면 전체 로그아웃을 출력한다', async () => {
      // Create a tokens file first so delete succeeds
      const dir = join(process.cwd(), '.union-cli')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'tokens.json'), JSON.stringify({'my-ns': {cookies: 'test=1'}}))

      const {stderr} = await runCmd(['auth:logout', '--no-color'])
      expect(stderr).toContain('전체 로그아웃 완료')
    })

    it('namespace를 지정하면 해당 provider 로그아웃을 출력한다', async () => {
      // Create a tokens file with the namespace token
      const dir = join(process.cwd(), '.union-cli')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'tokens.json'), JSON.stringify({'my-ns': {cookies: 'test=1'}}))

      const {stderr} = await runCmd(['auth:logout', 'my-ns', '--no-color'])
      expect(stderr).toContain('my-ns')
      expect(stderr).toContain('로그아웃 완료')
    })
  })

  describe('auth token', () => {
    beforeEach(() => {
      setupMockExecutor([
        {namespace: 'my-ns', authType: 'cookie', authServiceName: 'my-ns'},
      ])
    })
    afterEach(() => {
      teardownMockExecutor()
      const tokensPath = join(process.cwd(), '.union-cli', 'tokens.json')
      if (existsSync(tokensPath)) {
        rmSync(tokensPath)
      }
    })

    it('namespace의 토큰을 출력한다', async () => {
      // Create a tokens file with a token
      const dir = join(process.cwd(), '.union-cli')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'tokens.json'), JSON.stringify({
        'my-ns': {cookies: 'my-ns_token=abc123'},
      }))

      const {stdout} = await runCmd(['auth:token', 'my-ns'])
      expect(stdout).toContain('abc123')
    })

    it('--json 플래그로 JSON 출력한다', async () => {
      const dir = join(process.cwd(), '.union-cli')
      mkdirSync(dir, {recursive: true})
      writeFileSync(join(dir, 'tokens.json'), JSON.stringify({
        'my-ns': {cookies: 'my-ns_token=abc123'},
      }))

      const {stdout} = await runCmd(['auth:token', 'my-ns', '--json'])
      const parsed = JSON.parse(stdout)
      expect(parsed.namespace).toBe('my-ns')
      expect(parsed.token).toBe('abc123')
    })
  })

  describe('config set', () => {
    it('설정값을 저장하고 확인 메시지를 출력한다', async () => {
      const {stdout} = await runCmd(['config:set', 'test.key', 'test-value'])
      expect(stdout).toContain('test.key = test-value')
    })
  })

  describe('config get', () => {
    it('설정되지 않은 키를 조회하면 안내 메시지를 출력한다', async () => {
      const {stdout} = await runCmd(['config:get', 'nonexistent.key'])
      expect(stdout).toContain('nonexistent.key')
    })
  })

  describe('config list', () => {
    it('--json 플래그로 JSON 출력한다', async () => {
      const {stdout} = await runCmd(['config:list', '--json'])
      const parsed = JSON.parse(stdout)
      expect(typeof parsed).toBe('object')
    })
  })

  describe('config reset', () => {
    it('키 없이 실행하면 전체 초기화를 출력한다', async () => {
      const {stdout} = await runCmd(['config:reset'])
      expect(stdout).toContain('전체 설정 초기화 완료')
    })

    it('키를 지정하면 해당 키 초기화를 출력한다', async () => {
      const {stdout} = await runCmd(['config:reset', 'my.key'])
      expect(stdout).toContain('my.key')
      expect(stdout).toContain('초기화 완료')
    })
  })

  describe('init', () => {
    it('프로젝트 초기화 메시지를 출력한다', async () => {
      const {stdout} = await runCmd(['init', '--force'])
      expect(stdout).toContain('프로젝트 초기화 완료')
      expect(stdout).toContain('다음 단계')
    })
  })
})
