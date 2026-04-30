import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'

import {AuthManager, parseJwtExp} from '../src/core/auth.js'
import type {CredentialStore} from '../src/core/credential-store.js'
import type {AuthConfig} from '../src/core/types.js'

// ── 테스트용 인메모리 CredentialStore ──

class InMemoryCredentialStore implements CredentialStore {
  private data = new Map<string, Record<string, string>>()

  async get(ns: string): Promise<Record<string, string> | null> {
    return this.data.get(ns) ?? null
  }

  async set(ns: string, creds: Record<string, string>): Promise<void> {
    this.data.set(ns, creds)
  }

  async delete(ns: string): Promise<void> {
    this.data.delete(ns)
  }
}

let store: InMemoryCredentialStore
let auth: AuthManager

beforeEach(() => {
  store = new InMemoryCredentialStore()
  auth = new AuthManager(store)
})

describe('AuthManager.getAuthHeader', () => {
  it('type "none"이면 빈 헤더를 반환한다', async () => {
    const config: AuthConfig = {type: 'none'}
    const headers = await auth.getAuthHeader('myapp', config)
    expect(headers).toEqual({})
  })

  it('type "bearer"이면 Authorization Bearer 헤더를 반환한다', async () => {
    const config: AuthConfig = {
      type: 'bearer',
      token: {value: 'my-token-value'},
    }
    const headers = await auth.getAuthHeader('myapp', config)
    expect(headers).toEqual({Authorization: 'Bearer my-token-value'})
  })

  it('type "basic"이면 Authorization Basic 헤더를 반환한다', async () => {
    const config: AuthConfig = {
      type: 'basic',
      credentials: {
        username: {value: 'admin'},
        password: {value: 's3cret'},
      },
    }
    const headers = await auth.getAuthHeader('myapp', config)

    const expected = Buffer.from('admin:s3cret').toString('base64')
    expect(headers).toEqual({Authorization: `Basic ${expected}`})
  })

  it('type "api-key"이면 지정된 헤더에 토큰을 설정한다', async () => {
    const config: AuthConfig = {
      type: 'api-key',
      token: {value: 'api-key-123'},
      headerName: 'X-Custom-Key',
    }
    const headers = await auth.getAuthHeader('myapp', config)
    expect(headers).toEqual({'X-Custom-Key': 'api-key-123'})
  })

  it('type "api-key"에 headerName이 없으면 기본값 X-API-Key를 사용한다', async () => {
    const config: AuthConfig = {
      type: 'api-key',
      token: {value: 'api-key-456'},
    }
    const headers = await auth.getAuthHeader('myapp', config)
    expect(headers).toEqual({'X-API-Key': 'api-key-456'})
  })

  it('bearer에서 token을 resolve할 수 없으면 빈 헤더를 반환한다', async () => {
    const config: AuthConfig = {
      type: 'bearer',
      token: {env: 'DEFINITELY_MISSING_ENV_VAR'},
    }
    const headers = await auth.getAuthHeader('myapp', config)
    expect(headers).toEqual({})
  })
})

describe('AuthManager.isAuthenticated', () => {
  it('store에 자격 증명이 있으면 true를 반환한다', async () => {
    await store.set('myapp', {token: 'abc'})
    expect(await auth.isAuthenticated('myapp')).toBe(true)
  })

  it('store에 자격 증명이 없으면 false를 반환한다', async () => {
    expect(await auth.isAuthenticated('myapp')).toBe(false)
  })
})

// ── parseJwtExp ──

describe('parseJwtExp', () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({alg: 'none', typ: 'JWT'})).toString('base64url')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${header}.${body}.sig`
  }

  it('JWT payload의 exp 필드를 숫자로 반환한다', () => {
    const token = makeJwt({exp: 1700000000, sub: 'u1'})
    expect(parseJwtExp(token)).toBe(1700000000)
  })

  it('exp가 없으면 null을 반환한다', () => {
    const token = makeJwt({sub: 'u1'})
    expect(parseJwtExp(token)).toBeNull()
  })

  it('비JWT 문자열은 null을 반환한다', () => {
    expect(parseJwtExp('not.a.jwt.at.all')).toBeNull()
    expect(parseJwtExp('onlyonepart')).toBeNull()
  })

  it('깨진 base64는 null을 반환한다', () => {
    expect(parseJwtExp('aaa.!!!.bbb')).toBeNull()
  })
})

// ── AuthManager JWT — TTL 처리 (H3) + 동시성 디듀프 (H4) ──

describe('AuthManager JWT TTL/refresh dedup', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function makeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({alg: 'none', typ: 'JWT'})).toString('base64url')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${header}.${body}.sig`
  }

  /** 내부 jwtCache에 접근해 만료 시각을 검증하기 위한 헬퍼(타입 캐스트만 담당). */
  function getCachedExpiry(mgr: AuthManager, ns: string): number {
    const cache = (mgr as unknown as {jwtCache: Map<string, {expiresAt: number}>}).jwtCache
    const entry = cache.get(ns)
    if (!entry) throw new Error(`no cached token for ${ns}`)
    return entry.expiresAt
  }

  it('응답에 expires_in이 있으면 그 값을 TTL로 사용한다 (30초 안전 마진 차감)', async () => {
    const token = makeJwt({sub: 'u'})
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({access_token: token, expires_in: 120}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }),
    ) as unknown as typeof fetch

    const config: AuthConfig = {type: 'jwt', tokenEndpoint: 'http://x/login'}
    const t0 = Date.now()
    await auth.getAuthHeader('myapp', config)
    // 안전 마진 30초 차감 → 캐시 만료는 약 t0 + 90_000ms
    const expiresAt = getCachedExpiry(auth, 'myapp')
    expect(expiresAt - t0).toBeGreaterThanOrEqual(89_000)
    expect(expiresAt - t0).toBeLessThanOrEqual(91_000)
  })

  it('expires_in이 없으면 JWT exp claim에서 TTL을 계산한다', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const expSec = nowSec + 200
    const token = makeJwt({sub: 'u', exp: expSec})
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({access_token: token}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }),
    ) as unknown as typeof fetch

    const config: AuthConfig = {type: 'jwt', tokenEndpoint: 'http://x/login'}
    await auth.getAuthHeader('myapp', config)
    // 만료까지 약 170초 (200 - 30 안전 마진)
    const remaining = (getCachedExpiry(auth, 'myapp') - Date.now()) / 1000
    expect(remaining).toBeGreaterThanOrEqual(160)
    expect(remaining).toBeLessThanOrEqual(175)
  })

  it('expires_in도 exp도 없으면 authConfig.tokenTTL을 사용한다', async () => {
    const token = makeJwt({sub: 'u'})
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({access_token: token}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }),
    ) as unknown as typeof fetch

    const config: AuthConfig = {type: 'jwt', tokenEndpoint: 'http://x/login', tokenTTL: 500}
    await auth.getAuthHeader('myapp', config)
    const remaining = (getCachedExpiry(auth, 'myapp') - Date.now()) / 1000
    expect(remaining).toBeGreaterThanOrEqual(465)
    expect(remaining).toBeLessThanOrEqual(475)
  })

  it('동시 getAuthHeader 호출은 단 한 번만 토큰 엔드포인트를 호출한다 (refresh dedup)', async () => {
    const token = makeJwt({sub: 'u'})
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      // 비동기 간 시간을 줘서 두 번째 호출이 진행 중 Promise를 재사용하도록 유도
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Response(JSON.stringify({access_token: token, expires_in: 3600}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      })
    }) as unknown as typeof fetch

    const config: AuthConfig = {type: 'jwt', tokenEndpoint: 'http://x/login'}
    const [h1, h2, h3] = await Promise.all([
      auth.getAuthHeader('myapp', config),
      auth.getAuthHeader('myapp', config),
      auth.getAuthHeader('myapp', config),
    ])

    expect(calls).toBe(1)
    expect(h1).toEqual(h2)
    expect(h2).toEqual(h3)
    expect(h1.Authorization).toMatch(/^Bearer /)
  })

  it('refresh 실패 시 진행 중 Promise Map이 정리되어 다음 호출이 새로 시도한다', async () => {
    const token = makeJwt({sub: 'u'})
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      if (calls === 1) {
        return new Response('fail', {status: 500, statusText: 'Internal Server Error'})
      }
      return new Response(JSON.stringify({access_token: token, expires_in: 3600}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      })
    }) as unknown as typeof fetch

    const config: AuthConfig = {type: 'jwt', tokenEndpoint: 'http://x/login'}
    await expect(auth.getAuthHeader('myapp', config)).rejects.toThrow(/JWT refresh failed/)
    // 두 번째 시도는 새 fetch를 수행해야 한다
    const headers = await auth.getAuthHeader('myapp', config)
    expect(headers.Authorization).toMatch(/^Bearer /)
    expect(calls).toBe(2)
  })

  it('tokenRequestFormat=form이면 application/x-www-form-urlencoded로 요청한다', async () => {
    const token = makeJwt({sub: 'u'})
    let capturedHeaders: Record<string, string> = {}
    let capturedBody = ''
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      )
      capturedBody = init.body as string
      return new Response(JSON.stringify({access_token: token, expires_in: 3600}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      })
    }) as unknown as typeof fetch

    const config: AuthConfig = {
      type: 'jwt',
      tokenEndpoint: 'http://x/token',
      tokenRequestFormat: 'form',
      clientId: 'my-client',
      clientSecret: {value: 'my-secret'},
      grantType: 'password',
      scope: 'openid',
      credentials: {
        username: {value: 'testuser'},
        password: {value: 'testpass'},
      },
    }
    const headers = await auth.getAuthHeader('myapp', config)

    expect(capturedHeaders['Content-Type']).toBe('application/x-www-form-urlencoded')
    const params = new URLSearchParams(capturedBody)
    expect(params.get('grant_type')).toBe('password')
    expect(params.get('client_id')).toBe('my-client')
    expect(params.get('client_secret')).toBe('my-secret')
    expect(params.get('username')).toBe('testuser')
    expect(params.get('password')).toBe('testpass')
    expect(params.get('scope')).toBe('openid')
    expect(headers.Authorization).toMatch(/^Bearer /)
  })

  it('tokenRequestFormat이 없으면 기존 JSON 방식으로 요청한다', async () => {
    const token = makeJwt({sub: 'u'})
    let capturedHeaders: Record<string, string> = {}
    let capturedBody = ''
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>),
      )
      capturedBody = init.body as string
      return new Response(JSON.stringify({access_token: token, expires_in: 3600}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      })
    }) as unknown as typeof fetch

    const config: AuthConfig = {
      type: 'jwt',
      tokenEndpoint: 'http://x/login',
      credentials: {
        username: {value: 'admin'},
        password: {value: 'pass'},
      },
    }
    await auth.getAuthHeader('myapp', config)

    expect(capturedHeaders['Content-Type']).toBe('application/json')
    const parsed = JSON.parse(capturedBody)
    expect(parsed.username).toBe('admin')
    expect(parsed.password).toBe('pass')
  })

  it('3개의 동시 caller가 모두 refresh에 실패하면 각자 rejection을 받고 fetch는 한 번만 호출된다', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      // 네트워크 지연을 흉내내 3개 호출이 동일 진행 Promise를 공유하도록 유도
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Response('fail', {status: 500, statusText: 'Internal Server Error'})
    }) as unknown as typeof fetch

    const config: AuthConfig = {type: 'jwt', tokenEndpoint: 'http://x/login'}
    const results = await Promise.allSettled([
      auth.getAuthHeader('myapp', config),
      auth.getAuthHeader('myapp', config),
      auth.getAuthHeader('myapp', config),
    ])

    // 세 caller 모두 rejection을 받아야 한다.
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    // 동시성 디듀프에 의해 fetch는 단 한 번만 호출되어야 한다.
    expect(calls).toBe(1)

    // Map이 정리되었는지: 후속 성공 fetch가 새로 호출되는지 확인
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({access_token: makeJwt({sub: 'u'}), expires_in: 3600}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }),
    ) as unknown as typeof fetch
    const ok = await auth.getAuthHeader('myapp', config)
    expect(ok.Authorization).toMatch(/^Bearer /)
  })
})
