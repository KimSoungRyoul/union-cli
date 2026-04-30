import {describe, it, expect, beforeAll, afterAll, beforeEach} from 'vitest'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import {HTTPProvider} from '../src/providers/http/provider.js'
import {AuthManager} from '../src/core/auth.js'
import {EnvCredentialStore} from '../src/core/credential-store.js'
import type {CommandSpec, HttpProviderConfig} from '../src/core/types.js'

/**
 * HTTPProvider.execute의 실제 요청 경로를 검증하는 통합 테스트.
 * Node 내장 http.createServer로 가벼운 에코 서버를 띄워, 요청이 어떻게 구성되는지 관찰한다.
 */

interface Capture {
  method?: string
  path?: string
  headers?: http.IncomingHttpHeaders
  body?: string
  count: number
}

let server: http.Server
let baseUrl: string
let capture: Capture
/** 핸들러 오버라이드 가능 — 테스트별로 응답 커스터마이징 */
let handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      capture.count++
      capture.method = req.method
      capture.path = req.url
      capture.headers = req.headers
      capture.body = body
      handler(req, res, body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  capture = {count: 0}
  handler = (_req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'})
    res.end(JSON.stringify({ok: true}))
  }
})

function makeSpec(overrides: {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  flags?: CommandSpec['flags']
  args?: CommandSpec['args']
}): CommandSpec {
  return {
    id: 'test:cmd',
    namespace: 'test',
    description: 'test',
    args: overrides.args ?? [],
    flags: overrides.flags ?? [],
    examples: [],
    providerType: 'http',
    providerConfig: {
      type: 'http',
      method: overrides.method ?? 'GET',
      path: overrides.path,
      body: overrides.body,
    },
  }
}

function makeProvider(config: Partial<HttpProviderConfig> = {}): HTTPProvider {
  return new HTTPProvider({baseUrl, ...config}, 'test')
}

describe('HTTPProvider.execute — 통합', () => {
  it('httpMap: header flag가 실제 요청 헤더로 전송된다 (C1)', async () => {
    const provider = makeProvider()
    const spec = makeSpec({
      path: '/items',
      flags: [{name: 'trace-id', httpMap: 'header', httpName: 'X-Trace-Id'}],
    })
    const result = await provider.execute(spec, {args: {}, flags: {'trace-id': 'abc-123'}, raw: []})
    expect(result.success).toBe(true)
    expect(capture.headers?.['x-trace-id']).toBe('abc-123')
  })

  it('GET 요청 + body 없음일 때 Content-Type은 전송되지 않는다 (M2)', async () => {
    const provider = makeProvider()
    const spec = makeSpec({path: '/items', method: 'GET'})
    await provider.execute(spec, {args: {}, flags: {}, raw: []})
    expect(capture.headers?.['content-type']).toBeUndefined()
  })

  it('POST 요청 + body 있음일 때 Content-Type: application/json이 자동 세팅된다', async () => {
    const provider = makeProvider()
    const spec = makeSpec({
      path: '/items',
      method: 'POST',
      flags: [{name: 'name', httpMap: 'body'}],
    })
    await provider.execute(spec, {args: {}, flags: {name: 'foo'}, raw: []})
    expect(capture.headers?.['content-type']).toBe('application/json')
    expect(JSON.parse(capture.body ?? '')).toEqual({name: 'foo'})
  })

  it('header flag로 Content-Type을 오버라이드하면 기본값을 덮어쓴다', async () => {
    const provider = makeProvider()
    const spec = makeSpec({
      path: '/items',
      method: 'POST',
      body: {static: 1},
      flags: [{name: 'ct', httpMap: 'header', httpName: 'Content-Type'}],
    })
    await provider.execute(spec, {args: {}, flags: {ct: 'application/vnd.api+json'}, raw: []})
    expect(capture.headers?.['content-type']).toBe('application/vnd.api+json')
  })

  it('배열 query flag는 ?ids=1&ids=2 형태로 전송된다 (M1)', async () => {
    const provider = makeProvider()
    const spec = makeSpec({
      path: '/items',
      flags: [{name: 'ids', httpMap: 'query'}],
    })
    await provider.execute(spec, {args: {}, flags: {ids: ['1', '2', '3']}, raw: []})
    expect(capture.path).toBe('/items?ids=1&ids=2&ids=3')
  })

  it('빈 문자열 path 파라미터는 HTTP_PATH_ERROR를 반환한다 (M5)', async () => {
    const provider = makeProvider()
    const spec = makeSpec({
      path: '/items/{id}',
      args: [{name: 'id'}],
    })
    const result = await provider.execute(spec, {args: {id: ''}, flags: {}, raw: []})
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('HTTP_PATH_ERROR')
    expect(capture.count).toBe(0) // fetch 자체가 일어나지 않음
  })

  it('JWT tokenEndpoint가 절대 URL이면 해당 URL로 POST한다 (C2)', async () => {
    // 절대 URL로 같은 서버 가리키지만, baseUrl과 합쳐지지 않아야 한다.
    const absoluteTokenUrl = `${baseUrl}/absolute/login`
    const provider = new HTTPProvider(
      {
        baseUrl: `${baseUrl}/api/v1`,
        auth: {
          type: 'jwt',
          tokenEndpoint: absoluteTokenUrl,
          credentials: {username: {value: 'u'}, password: {value: 'p'}},
        },
      },
      'test-jwt-abs',
      new AuthManager(new EnvCredentialStore()),
    )

    let tokenEndpointHit = false
    handler = (req, res) => {
      if (req.url === '/absolute/login') {
        tokenEndpointHit = true
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({access_token: 'abs-token', expires_in: 3600}))
      } else {
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({hit: req.url}))
      }
    }

    const spec = makeSpec({path: '/items'})
    const result = await provider.execute(spec, {args: {}, flags: {}, raw: []})
    expect(result.success).toBe(true)
    expect(tokenEndpointHit).toBe(true)
    expect(capture.path).toBe('/api/v1/items')
    expect(capture.headers?.['authorization']).toBe('Bearer abs-token')
  })

  it('JWT 토큰 발급 실패 시 메인 엔드포인트로 요청하지 않고 HTTP_AUTH_ERROR를 반환한다 (C3)', async () => {
    const provider = new HTTPProvider(
      {
        baseUrl,
        auth: {
          type: 'jwt',
          tokenEndpoint: '/login',
          credentials: {username: {value: 'u'}, password: {value: 'p'}},
        },
      },
      'test-jwt-fail',
      new AuthManager(new EnvCredentialStore()),
    )

    let mainEndpointHit = 0
    handler = (req, res) => {
      if (req.url === '/login') {
        res.writeHead(401)
        res.end('unauthorized')
      } else {
        mainEndpointHit++
        res.writeHead(200)
        res.end('ok')
      }
    }

    const spec = makeSpec({path: '/items'})
    const result = await provider.execute(spec, {args: {}, flags: {}, raw: []})
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('HTTP_AUTH_ERROR')
    expect(mainEndpointHit).toBe(0) // 메인 엔드포인트는 호출되지 않아야 한다
    // 깨진 "Authorization: Bearer " 헤더도 서버로 가지 않음 (요청 자체가 없음)
  })

  it('healthcheck는 auth 헤더를 포함해 요청한다 (M3)', async () => {
    const provider = new HTTPProvider(
      {
        baseUrl,
        auth: {type: 'bearer', token: {value: 'health-token'}},
      },
      'test-health',
    )
    await provider.healthCheck()
    expect(capture.headers?.['authorization']).toBe('Bearer health-token')
  })

  it('healthcheck가 401을 받으면 healthy=false + authentication required 메시지', async () => {
    const provider = new HTTPProvider({baseUrl, auth: {type: 'none'}}, 'test-health-401')
    handler = (_req, res) => {
      res.writeHead(401)
      res.end()
    }
    const result = await provider.healthCheck()
    expect(result.healthy).toBe(false)
    expect(result.message).toContain('authentication required')
  })

  it('healthcheck: resolveCredentials가 throw해도 reachability 체크는 계속된다', async () => {
    // JWT 토큰 엔드포인트가 존재하지 않는 도메인을 가리키게 해서 resolveCredentials를 실패시킨다.
    const provider = new HTTPProvider(
      {
        baseUrl,
        auth: {
          type: 'jwt',
          tokenEndpoint: 'http://127.0.0.1:1/never-resolves',
          credentials: {username: {value: 'u'}, password: {value: 'p'}},
        },
      },
      'test-health-auth-throw',
      new AuthManager(new EnvCredentialStore()),
    )
    // 메인 baseUrl 자체는 reachable (기본 200 응답)
    const result = await provider.healthCheck()
    expect(result.healthy).toBe(true) // auth 없이 요청해도 서버는 200을 돌려주므로
    // auth 헤더는 없어야 한다 (resolveCredentials가 throw → catch → authHeaders={})
    expect(capture.headers?.['authorization']).toBeUndefined()
  })

  it('config.headers의 undefined 값은 요청 헤더에서 제거된다 (L5)', async () => {
    const provider = new HTTPProvider(
      {
        baseUrl,
        // TypeScript 타입상 string이지만 런타임에서 undefined가 올 수 있는 경로 시뮬레이션
        headers: {'X-Good': 'yes', 'X-Bad': undefined as unknown as string},
      },
      'test-undef',
    )
    const spec = makeSpec({path: '/items'})
    await provider.execute(spec, {args: {}, flags: {}, raw: []})
    expect(capture.headers?.['x-good']).toBe('yes')
    expect(capture.headers?.['x-bad']).toBeUndefined()
  })
})
