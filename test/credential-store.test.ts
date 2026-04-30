import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  FileCredentialStore,
  EnvCredentialStore,
  resolveSecret,
} from '../src/core/credential-store.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cred-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true})
})

describe('FileCredentialStore', () => {
  it('set → get으로 자격 증명을 저장하고 읽는다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await store.set('myapp', {token: 'abc123', user: 'admin'})

    const creds = await store.get('myapp')
    expect(creds).toEqual({token: 'abc123', user: 'admin'})
  })

  it('파일 권한을 0o600으로 설정한다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await store.set('myapp', {token: 'secret'})

    const stat = await fs.stat(path.join(tmpDir, 'myapp.json'))
    // 0o600 = 384 decimal; check owner permissions only (mask with 0o777)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('존재하지 않는 namespace는 null을 반환한다', async () => {
    const store = new FileCredentialStore(tmpDir)
    const creds = await store.get('unknown')
    expect(creds).toBeNull()
  })

  it('delete로 자격 증명을 삭제한다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await store.set('myapp', {token: 'abc'})
    await store.delete('myapp')

    const creds = await store.get('myapp')
    expect(creds).toBeNull()
  })

  it('존재하지 않는 namespace를 delete해도 에러가 발생하지 않는다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await expect(store.delete('nonexistent')).resolves.toBeUndefined()
  })

  it('list()는 저장된 namespace 목록을 반환한다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await store.set('app1', {token: 't1'})
    await store.set('app2', {token: 't2'})

    const namespaces = await store.list()
    expect(namespaces.sort()).toEqual(['app1', 'app2'])
  })

  it('list()는 디렉토리가 없으면 빈 배열을 반환한다', async () => {
    const store = new FileCredentialStore(path.join(tmpDir, 'does-not-exist'))
    const namespaces = await store.list()
    expect(namespaces).toEqual([])
  })
})

describe('resolveSecret', () => {
  it('env로 환경 변수 값을 읽는다', async () => {
    process.env['TEST_RESOLVE_SECRET_TOKEN'] = 'env-value-123'
    try {
      const val = await resolveSecret({env: 'TEST_RESOLVE_SECRET_TOKEN'})
      expect(val).toBe('env-value-123')
    } finally {
      delete process.env['TEST_RESOLVE_SECRET_TOKEN']
    }
  })

  it('value로 직접 값을 반환한다', async () => {
    const val = await resolveSecret({value: 'direct-secret'})
    expect(val).toBe('direct-secret')
  })

  it('존재하지 않는 환경 변수는 null을 반환한다', async () => {
    const val = await resolveSecret({env: 'DEFINITELY_NOT_SET_XYZ_123'})
    expect(val).toBeNull()
  })

  it('빈 ref는 null을 반환한다', async () => {
    const val = await resolveSecret({})
    expect(val).toBeNull()
  })

  it('file이 존재하지 않으면 null을 반환한다 (ENOENT)', async () => {
    const val = await resolveSecret({file: '/tmp/nonexistent-secret-file-xyz'})
    expect(val).toBeNull()
  })

  it('file 권한 거부 시 에러를 던진다 (EACCES)', async () => {
    // Create a file and remove read permissions to trigger EACCES
    const noReadFile = path.join(tmpDir, 'no-read-secret')
    await fs.writeFile(noReadFile, 'secret-data')
    await fs.chmod(noReadFile, 0o000) // no permissions at all

    try {
      await expect(resolveSecret({file: noReadFile})).rejects.toThrow(
        `Permission denied reading secret file: "${noReadFile}"`,
      )
    } finally {
      // Restore permissions so cleanup can delete it
      await fs.chmod(noReadFile, 0o644)
    }
  })

  it('command로 시크릿 값을 읽는다', async () => {
    const val = await resolveSecret({command: 'echo hello-secret'})
    expect(val).toBe('hello-secret')
  })

  it('command를 찾을 수 없으면 에러를 던진다', async () => {
    await expect(
      resolveSecret({command: 'nonexistent-binary-xyz-123'}),
    ).rejects.toThrow('Command not found: "nonexistent-binary-xyz-123"')
  })

  it('command 실패 시 exit code와 함께 에러를 던진다', async () => {
    await expect(
      resolveSecret({command: 'node -e process.exit(42)'}),
    ).rejects.toThrow('Secret command failed (exit code 42)')
  })
})

// ── EnvCredentialStore ──

describe('EnvCredentialStore', () => {
  const ENV_KEYS = ['MYCLI_PROD_TOKEN', 'MYCLI_DEV_TOKEN', 'PROD_TOKEN', 'DEV_TOKEN']

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
  })

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k]
  })

  it('cliName 지정 시 <CLI>_<NS>_TOKEN 형식의 env 에서 token 회수', async () => {
    process.env['MYCLI_PROD_TOKEN'] = 'env-token-prod'
    const store = new EnvCredentialStore('mycli')

    const creds = await store.get('prod')
    expect(creds).toEqual({token: 'env-token-prod'})
  })

  it('cliName 미지정 시 legacy <NS>_TOKEN 형식 사용', async () => {
    process.env['PROD_TOKEN'] = 'legacy-token'
    const store = new EnvCredentialStore()

    const creds = await store.get('prod')
    expect(creds).toEqual({token: 'legacy-token'})
  })

  it('cliName 지정 + prefix 변수 미설정 시 legacy 변수로 fallback', async () => {
    process.env['DEV_TOKEN'] = 'legacy-fallback'
    const store = new EnvCredentialStore('mycli')

    const creds = await store.get('dev')
    expect(creds).toEqual({token: 'legacy-fallback'})
  })

  it('환경변수 미설정 시 null 반환', async () => {
    const store = new EnvCredentialStore('mycli')
    const creds = await store.get('prod')
    expect(creds).toBeNull()
  })

  it('set() 호출 시 throw — env 는 immutable', async () => {
    const store = new EnvCredentialStore('mycli')
    await expect(store.set('prod', {token: 'x'})).rejects.toThrow(/read-only/)
  })

  it('delete() 호출 시 throw — env 는 immutable', async () => {
    const store = new EnvCredentialStore('mycli')
    await expect(store.delete('prod')).rejects.toThrow(/read-only/)
  })

  it('namespace 의 hyphen 등 비-alphanumeric 문자는 _ 로 정규화', async () => {
    process.env['MYCLI_MY_APP_TOKEN'] = 'normalized'
    const store = new EnvCredentialStore('mycli')

    const creds = await store.get('my-app')
    expect(creds).toEqual({token: 'normalized'})
  })
})

// ── KeychainCredentialStore (mocked spawn) ──

describe('KeychainCredentialStore — macOS', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('set/get 라운드트립: security CLI 가 호출되고 payload 가 JSON 으로 직렬화된다', async () => {
    let stored: string | null = null

    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        execFileSync: vi.fn((cmd: string, args: string[]) => {
          if (cmd !== 'security') throw new Error(`unexpected cmd: ${cmd}`)
          if (args[0] === 'add-generic-password') {
            const wIdx = args.indexOf('-w')
            stored = args[wIdx + 1]
            return ''
          }
          if (args[0] === 'find-generic-password') {
            if (stored == null) {
              const e = new Error('not found') as Error & {status: number; stderr: string}
              e.status = 44
              e.stderr = 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.'
              throw e
            }
            return stored + '\n'
          }
          if (args[0] === 'delete-generic-password') {
            stored = null
            return ''
          }
          throw new Error(`unexpected security args: ${args.join(' ')}`)
        }),
        spawnSync: vi.fn(() => ({status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })

    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    const store = new Store({cliName: 'mycli', account: 'tester', platform: 'darwin'})

    expect(await store.get('prod')).toBeNull() // not stored yet
    await store.set('prod', {token: 'abc', user: 'admin'})
    expect(stored).toBe(JSON.stringify({token: 'abc', user: 'admin'}))

    const got = await store.get('prod')
    expect(got).toEqual({token: 'abc', user: 'admin'})

    await store.delete('prod')
    expect(stored).toBeNull()
    expect(await store.get('prod')).toBeNull()
  })

  it('serviceName 은 cliName-namespace 로 구성된다', async () => {
    const calls: Array<{cmd: string; args: string[]}> = []

    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        execFileSync: vi.fn((cmd: string, args: string[]) => {
          calls.push({cmd, args})
          return ''
        }),
        spawnSync: vi.fn(() => ({status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })

    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    const store = new Store({cliName: 'mycli', account: 'tester', platform: 'darwin'})
    await store.set('prod', {token: 'x'})

    const setCall = calls.find(c => c.args[0] === 'add-generic-password')
    expect(setCall).toBeDefined()
    const sIdx = setCall!.args.indexOf('-s')
    expect(setCall!.args[sIdx + 1]).toBe('mycli-prod')
  })

  it('keychain locked / 권한 에러는 throw 된다 (사용자 인지 가능)', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        execFileSync: vi.fn(() => {
          const e = new Error('User interaction required.') as Error & {status: number; stderr: string}
          e.status = 51
          e.stderr = 'security: User interaction is not allowed.'
          throw e
        }),
        spawnSync: vi.fn(() => ({status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })

    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    const store = new Store({cliName: 'mycli', account: 'tester', platform: 'darwin'})
    await expect(store.get('prod')).rejects.toThrow(/User interaction|allowed/)
  })
})

describe('KeychainCredentialStore — Linux', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('set/get 라운드트립: secret-tool store/lookup', async () => {
    let stored: string | null = null

    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        execFileSync: vi.fn((cmd: string, args: string[]) => {
          if (cmd !== 'secret-tool') throw new Error(`unexpected cmd: ${cmd}`)
          if (args[0] === 'lookup') {
            if (stored == null) {
              const e = new Error('not found') as Error & {status: number; stderr: string}
              e.status = 1
              e.stderr = ''
              throw e
            }
            return stored
          }
          throw new Error(`unexpected secret-tool: ${args.join(' ')}`)
        }),
        spawnSync: vi.fn((cmd: string, args: string[], opts?: {input?: string}) => {
          if (cmd === 'secret-tool' && args[0] === 'store') {
            stored = opts?.input ?? ''
            return {status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')}
          }
          if (cmd === 'secret-tool' && args[0] === 'clear') {
            stored = null
            return {status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')}
          }
          return {status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')}
        }),
      }
    })

    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    const store = new Store({cliName: 'mycli', account: 'tester', platform: 'linux'})

    expect(await store.get('prod')).toBeNull()
    await store.set('prod', {token: 'lin-abc'})
    expect(stored).toBe(JSON.stringify({token: 'lin-abc'}))

    const got = await store.get('prod')
    expect(got).toEqual({token: 'lin-abc'})

    await store.delete('prod')
    expect(stored).toBeNull()
  })

  it('secret-tool store 가 non-zero exit 시 에러 throw', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        execFileSync: vi.fn(() => ''),
        spawnSync: vi.fn(() => ({
          status: 1,
          stdout: Buffer.from(''),
          stderr: Buffer.from('keyring locked', 'utf-8'),
        })),
      }
    })

    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    const store = new Store({cliName: 'mycli', account: 'tester', platform: 'linux'})
    await expect(store.set('prod', {token: 'x'})).rejects.toThrow(/secret-tool store failed/)
  })
})

describe('KeychainCredentialStore.isAvailable', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('도구가 PATH 에 있으면 true', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        spawnSync: vi.fn(() => ({status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })
    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    expect(Store.isAvailable('darwin')).toBe(true)
    expect(Store.isAvailable('linux')).toBe(true)
  })

  it('도구가 PATH 에 없으면 false', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        spawnSync: vi.fn(() => ({status: 1, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })
    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    expect(Store.isAvailable('darwin')).toBe(false)
  })

  it('지원하지 않는 platform 은 false', async () => {
    const {KeychainCredentialStore: Store} = await import('../src/core/credential-store.js')
    expect(Store.isAvailable('aix' as NodeJS.Platform)).toBe(false)
    expect(Store.isAvailable('sunos' as NodeJS.Platform)).toBe(false)
  })
})

// ── createCredentialStore factory ──

describe('createCredentialStore (factory)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('type=file (default) 은 FileCredentialStore 반환', async () => {
    const {createCredentialStore: factory, FileCredentialStore: F} = await import(
      '../src/core/credential-store.js'
    )
    const store = factory({cliName: 'mycli', baseDir: tmpDir})
    expect(store).toBeInstanceOf(F)
  })

  it('type=env 는 EnvCredentialStore 반환', async () => {
    const {createCredentialStore: factory, EnvCredentialStore: E} = await import(
      '../src/core/credential-store.js'
    )
    const store = factory({cliName: 'mycli', type: 'env'})
    expect(store).toBeInstanceOf(E)
  })

  it('type=keychain + 도구 설치 → KeychainCredentialStore 반환', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        spawnSync: vi.fn(() => ({status: 0, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })

    const {createCredentialStore: factory, KeychainCredentialStore: K} = await import(
      '../src/core/credential-store.js'
    )
    const store = factory({cliName: 'mycli', type: 'keychain', platform: 'darwin'})
    expect(store).toBeInstanceOf(K)
  })

  it('type=keychain + 도구 미설치 → FileStore 로 graceful fallback (warning 출력)', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        spawnSync: vi.fn(() => ({status: 1, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const {createCredentialStore: factory, FileCredentialStore: F} = await import(
        '../src/core/credential-store.js'
      )
      const store = factory({
        cliName: 'mycli',
        type: 'keychain',
        platform: 'darwin',
        baseDir: tmpDir,
      })
      expect(store).toBeInstanceOf(F)
      // Logger uses console.error under the hood
      const printed = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(printed).toMatch(/keystore CLI not found|fallback/i)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('type=keychain + 도구 미설치 + fallbackToFile=false → throw', async () => {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        spawnSync: vi.fn(() => ({status: 1, stdout: Buffer.from(''), stderr: Buffer.from('')})),
      }
    })

    const {createCredentialStore: factory} = await import('../src/core/credential-store.js')
    expect(() =>
      factory({cliName: 'mycli', type: 'keychain', platform: 'darwin', fallbackToFile: false}),
    ).toThrow(/required CLI tool not found/)
  })

  it('baseDir 미지정 시 ~/.<cliName>/credentials 를 사용한다', async () => {
    const {createCredentialStore: factory, FileCredentialStore: F} = await import(
      '../src/core/credential-store.js'
    )
    const store = factory({cliName: 'mycli', type: 'file'})
    expect(store).toBeInstanceOf(F)
    // private credentialsDir 검증 (cast 로 접근)
    const dir = (store as unknown as {credentialsDir: string}).credentialsDir
    expect(dir).toBe(path.join(os.homedir(), '.mycli', 'credentials'))
  })
})
