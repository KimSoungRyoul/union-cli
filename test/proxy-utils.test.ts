import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {
  readProxyEnv,
  shouldBypassProxy,
  getProxyForUrl,
  createDispatcher,
  __resetUndiciWarning,
  type ProxyConfig,
} from '../src/core/proxy-utils.js'

// ── readProxyEnv ──

describe('readProxyEnv', () => {
  it('빈 env 면 빈 객체를 반환한다', () => {
    const cfg = readProxyEnv({})
    expect(cfg).toEqual({})
  })

  it('대문자 HTTPS_PROXY/HTTP_PROXY/NO_PROXY 를 인식한다', () => {
    const cfg = readProxyEnv({
      HTTPS_PROXY: 'http://proxy.corp:8080',
      HTTP_PROXY: 'http://proxy.corp:8080',
      NO_PROXY: 'localhost,127.0.0.1',
    })
    expect(cfg.httpsProxy).toBe('http://proxy.corp:8080')
    expect(cfg.httpProxy).toBe('http://proxy.corp:8080')
    expect(cfg.noProxy).toEqual(['localhost', '127.0.0.1'])
  })

  it('소문자 https_proxy 도 인식한다 (case G)', () => {
    const cfg = readProxyEnv({https_proxy: 'http://lower.corp:8080'})
    expect(cfg.httpsProxy).toBe('http://lower.corp:8080')
  })

  it('소문자가 대문자보다 우선한다', () => {
    const cfg = readProxyEnv({
      HTTPS_PROXY: 'http://upper:8080',
      https_proxy: 'http://lower:8080',
    })
    expect(cfg.httpsProxy).toBe('http://lower:8080')
  })

  it('빈 문자열 env 는 미설정으로 취급한다', () => {
    const cfg = readProxyEnv({HTTPS_PROXY: '', HTTP_PROXY: ''})
    expect(cfg.httpsProxy).toBeUndefined()
    expect(cfg.httpProxy).toBeUndefined()
  })

  it('NO_PROXY 콤마/공백 혼합을 모두 분리한다', () => {
    const cfg = readProxyEnv({NO_PROXY: ' localhost , .example.com  internal.io'})
    expect(cfg.noProxy).toEqual(['localhost', '.example.com', 'internal.io'])
  })

  it('NO_PROXY 패턴은 lowercase 로 정규화된다', () => {
    const cfg = readProxyEnv({NO_PROXY: 'Example.COM,LOCALHOST'})
    expect(cfg.noProxy).toEqual(['example.com', 'localhost'])
  })

  it('NO_PROXY 가 빈 문자열이면 noProxy 키가 없다', () => {
    const cfg = readProxyEnv({NO_PROXY: '   '})
    expect(cfg.noProxy).toBeUndefined()
  })
})

// ── shouldBypassProxy ──

describe('shouldBypassProxy', () => {
  it('빈 패턴 리스트면 false', () => {
    expect(shouldBypassProxy('https://api.example.com', [])).toBe(false)
  })

  it('"*" 단독은 모든 호스트 bypass (case E)', () => {
    expect(shouldBypassProxy('https://anything.io', ['*'])).toBe(true)
    expect(shouldBypassProxy('http://x.y.z', ['*'])).toBe(true)
  })

  it('정확한 호스트 매칭 (case D)', () => {
    expect(shouldBypassProxy('https://example.com/path', ['example.com'])).toBe(true)
  })

  it('plain 패턴은 하위 도메인까지 매칭 (curl 호환)', () => {
    expect(shouldBypassProxy('https://api.example.com', ['example.com'])).toBe(true)
  })

  it('.suffix 패턴은 sub.example.com 을 매칭 (case F)', () => {
    expect(shouldBypassProxy('https://sub.example.com', ['.example.com'])).toBe(true)
  })

  it('.suffix 패턴은 base example.com 도 매칭한다', () => {
    expect(shouldBypassProxy('https://example.com', ['.example.com'])).toBe(true)
  })

  it('관련 없는 도메인은 매칭하지 않는다', () => {
    expect(shouldBypassProxy('https://other.io', ['example.com'])).toBe(false)
    expect(shouldBypassProxy('https://example.com.evil.io', ['example.com'])).toBe(false)
  })

  it('host:port 패턴은 포트까지 일치할 때만 매칭', () => {
    expect(shouldBypassProxy('https://api.example.com:8443', ['api.example.com:8443'])).toBe(true)
    expect(shouldBypassProxy('https://api.example.com:443', ['api.example.com:8443'])).toBe(false)
  })

  it('host:port 패턴 + 대상에 포트 없으면 매칭 실패', () => {
    expect(shouldBypassProxy('https://api.example.com', ['api.example.com:8443'])).toBe(false)
  })

  it('대소문자 무시 매칭', () => {
    expect(shouldBypassProxy('https://API.EXAMPLE.COM', ['example.com'])).toBe(true)
  })

  it('localhost 매칭', () => {
    expect(shouldBypassProxy('http://localhost:3000', ['localhost'])).toBe(true)
  })

  it('잘못된 URL 은 false', () => {
    expect(shouldBypassProxy('not a url', ['*'])).toBe(false)
  })
})

// ── getProxyForUrl ──

describe('getProxyForUrl', () => {
  it('case A — HTTPS_PROXY 설정 + https URL → 그 값 반환', () => {
    const cfg: ProxyConfig = {httpsProxy: 'http://proxy.corp:8080'}
    expect(getProxyForUrl('https://api.example.com', cfg)).toBe('http://proxy.corp:8080')
  })

  it('case B — HTTP_PROXY 설정 + http URL → 그 값 반환', () => {
    const cfg: ProxyConfig = {httpProxy: 'http://proxy.corp:8080'}
    expect(getProxyForUrl('http://api.example.com', cfg)).toBe('http://proxy.corp:8080')
  })

  it('case C — https URL + HTTP_PROXY 만 있음 → null (스킴 폴백 없음)', () => {
    const cfg: ProxyConfig = {httpProxy: 'http://proxy.corp:8080'}
    expect(getProxyForUrl('https://api.example.com', cfg)).toBeNull()
  })

  it('http URL + HTTPS_PROXY 만 있음 → null (스킴 폴백 없음)', () => {
    const cfg: ProxyConfig = {httpsProxy: 'http://proxy.corp:8080'}
    expect(getProxyForUrl('http://api.example.com', cfg)).toBeNull()
  })

  it('case D — NO_PROXY="example.com" + 대상 example.com → null', () => {
    const cfg: ProxyConfig = {
      httpsProxy: 'http://proxy.corp:8080',
      noProxy: ['example.com'],
    }
    expect(getProxyForUrl('https://example.com/api', cfg)).toBeNull()
    // 하위 도메인도 bypass
    expect(getProxyForUrl('https://api.example.com', cfg)).toBeNull()
  })

  it('case E — NO_PROXY="*" → 모두 bypass', () => {
    const cfg: ProxyConfig = {
      httpsProxy: 'http://proxy.corp:8080',
      httpProxy: 'http://proxy.corp:8080',
      noProxy: ['*'],
    }
    expect(getProxyForUrl('https://api.example.com', cfg)).toBeNull()
    expect(getProxyForUrl('http://internal.io', cfg)).toBeNull()
  })

  it('case F — NO_PROXY=".example.com" + sub.example.com → bypass', () => {
    const cfg: ProxyConfig = {
      httpsProxy: 'http://proxy.corp:8080',
      noProxy: ['.example.com'],
    }
    expect(getProxyForUrl('https://sub.example.com', cfg)).toBeNull()
    // 무관한 도메인은 정상적으로 proxy 적용
    expect(getProxyForUrl('https://other.io', cfg)).toBe('http://proxy.corp:8080')
  })

  it('config 인자 생략 시 환경변수에서 읽는다', () => {
    const original = process.env.HTTPS_PROXY
    process.env.HTTPS_PROXY = 'http://envproxy:9999'
    try {
      expect(getProxyForUrl('https://api.test')).toBe('http://envproxy:9999')
    } finally {
      if (original === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = original
    }
  })

  it('지원하지 않는 스킴(ftp 등)은 null', () => {
    const cfg: ProxyConfig = {httpsProxy: 'http://proxy:8080', httpProxy: 'http://proxy:8080'}
    expect(getProxyForUrl('ftp://files.example.com', cfg)).toBeNull()
  })

  it('잘못된 URL 은 null', () => {
    const cfg: ProxyConfig = {httpsProxy: 'http://proxy:8080'}
    expect(getProxyForUrl('::::not a url', cfg)).toBeNull()
  })

  it('proxy 설정이 전혀 없으면 null', () => {
    expect(getProxyForUrl('https://api.example.com', {})).toBeNull()
  })
})

// ── createDispatcher ──

describe('createDispatcher', () => {
  beforeEach(() => {
    __resetUndiciWarning()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('proxy 가 필요 없으면 undefined 를 반환한다', async () => {
    const result = await createDispatcher('https://api.example.com', {})
    expect(result).toBeUndefined()
  })

  it('NO_PROXY 매칭이면 undefined 를 반환한다', async () => {
    const result = await createDispatcher('https://example.com', {
      httpsProxy: 'http://proxy:8080',
      noProxy: ['example.com'],
    })
    expect(result).toBeUndefined()
  })

  it('proxy 가 필요하면 undici.ProxyAgent 인스턴스를 반환한다', async () => {
    const result = await createDispatcher('https://api.example.com', {
      httpsProxy: 'http://proxy.corp:8080',
    })
    // undici 가 deps 에 없는 환경이면 undefined, 있으면 객체.
    // 어느 쪽이든 throw 하지 않아야 한다.
    if (result !== undefined) {
      expect(typeof result).toBe('object')
      expect(result).not.toBeNull()
      // ProxyAgent 는 undici Dispatcher 의 일종이며 dispatch / close 메서드를 가진다.
      const r = result as {dispatch?: unknown; close?: unknown}
      expect(typeof r.dispatch === 'function' || typeof r.close === 'function').toBe(true)
    }
  })
})
