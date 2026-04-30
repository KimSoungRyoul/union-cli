import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {pbkdf2Sync, createCipheriv} from 'node:crypto'

// ── discoverProfiles 테스트 ──

describe('discoverProfiles', () => {
  const mockFs = {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
  }

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        existsSync: mockFs.existsSync,
        readdirSync: mockFs.readdirSync,
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('브라우저 디렉토리가 없으면 빈 배열을 반환한다', async () => {
    mockFs.existsSync.mockReturnValue(false)
    const {discoverProfiles} = await import('../src/core/token-store.js')
    expect(discoverProfiles('/nonexistent')).toEqual([])
  })

  it('Cookies 파일이 있는 디렉토리만 반환한다', async () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      if (p === '/browser') return true
      if (p === '/browser/Default/Cookies') return true
      if (p === '/browser/Profile 1/Cookies') return true
      if (p === '/browser/Profile 2/Cookies') return false
      if (p === '/browser/BrowserMetrics/Cookies') return false
      return false
    })
    mockFs.readdirSync.mockReturnValue([
      {name: 'Default', isDirectory: () => true},
      {name: 'Profile 1', isDirectory: () => true},
      {name: 'Profile 2', isDirectory: () => true},
      {name: 'BrowserMetrics', isDirectory: () => true},
      {name: 'Local State', isDirectory: () => false},
    ])

    const {discoverProfiles} = await import('../src/core/token-store.js')
    const result = discoverProfiles('/browser')
    expect(result).toEqual(['Default', 'Profile 1'])
  })
})

// ── decryptCookieValue 테스트 ──

describe('decryptCookieValue', () => {
  // 테스트용 고정 키 생성
  const password = Buffer.from('test-password')
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')

  function encrypt(plaintext: string): Buffer {
    const iv = Buffer.alloc(16, ' ')
    const cipher = createCipheriv('aes-128-cbc', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    // v10 prefix 추가
    return Buffer.concat([Buffer.from('v10'), encrypted])
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('v10 prefix가 있는 암호화된 값을 정상 복호화한다', async () => {
    const {decryptCookieValue} = await import('../src/core/token-store.js')
    const encrypted = encrypt('hello-world')
    expect(decryptCookieValue(encrypted, key)).toBe('hello-world')
  })

  it('v10 prefix가 없으면 빈 문자열을 반환한다', async () => {
    const {decryptCookieValue} = await import('../src/core/token-store.js')
    expect(decryptCookieValue(Buffer.from('not-encrypted'), key)).toBe('')
  })

  it('데이터가 너무 짧으면 빈 문자열을 반환한다', async () => {
    const {decryptCookieValue} = await import('../src/core/token-store.js')
    expect(decryptCookieValue(Buffer.from('v1'), key)).toBe('')
  })

  it('잘못된 키로 복호화하면 빈 문자열을 반환한다', async () => {
    const {decryptCookieValue} = await import('../src/core/token-store.js')
    const encrypted = encrypt('hello')
    const wrongKey = Buffer.alloc(16, 0)
    expect(decryptCookieValue(encrypted, wrongKey)).toBe('')
  })
})

// ── decryptChromeCookies 테스트 ──

describe('decryptChromeCookies', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('macOS가 아니면 null을 반환한다', async () => {
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {...actual}
    })
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        execFileSync: vi.fn(() => { throw new Error('should not be called') }),
      }
    })

    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {value: 'linux', configurable: true})
    try {
      const {decryptChromeCookies} = await import('../src/core/token-store.js')
      expect(decryptChromeCookies('example.com')).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', {value: originalPlatform, configurable: true})
    }
  })

  it('프로필이 없으면 null을 반환한다', async () => {
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(false),
        readdirSync: vi.fn().mockReturnValue([]),
      }
    })

    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {value: 'darwin', configurable: true})
    try {
      const {decryptChromeCookies} = await import('../src/core/token-store.js')
      expect(decryptChromeCookies('example.com')).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', {value: originalPlatform, configurable: true})
    }
  })

  it('execFileSync 예외 발생 시 null을 반환한다 (best-effort)', async () => {
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(true),
        readdirSync: vi.fn().mockReturnValue([
          {name: 'Default', isDirectory: () => true},
        ]),
        copyFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      }
    })
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        execFileSync: vi.fn(() => { throw new Error('keychain access denied') }),
      }
    })

    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', {value: 'darwin', configurable: true})
    try {
      const {decryptChromeCookies} = await import('../src/core/token-store.js')
      expect(decryptChromeCookies('example.com')).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', {value: originalPlatform, configurable: true})
    }
  })
})
