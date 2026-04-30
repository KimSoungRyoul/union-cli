import {describe, it, expect, vi} from 'vitest'
import {
  buildPath,
  buildQueryParams,
  buildBody,
  buildHeaders,
  coerceBodyValue,
  resolveEndpointUrl,
  normalizeRetryConfig,
  computeBackoffMs,
  parseRetryAfter,
  isMethodRetryable,
  fetchWithRetry,
} from '../src/providers/http/provider.js'
import {applyAuth} from '../src/providers/http/auth-handlers.js'
import {logger} from '../src/core/logger.js'
import type {CommandSpec, AuthConfig} from '../src/core/types.js'

function makeHttpSpec(overrides: Partial<CommandSpec> = {}): CommandSpec {
  return {
    id: 'lona:loadtest:stop',
    namespace: 'lona',
    description: 'Stop a load test',
    args: [],
    flags: [],
    examples: [],
    providerType: 'http',
    providerConfig: {
      type: 'http' as const,
      method: 'POST' as const,
      path: '/loadtests/{id}/stop',
    },
    ...overrides,
  }
}

// ── buildPath ──

describe('buildPath', () => {
  it('단일 경로 파라미터를 치환한다', () => {
    const result = buildPath('/loadtests/{id}/stop', {id: 'lt-001'})
    expect(result).toBe('/loadtests/lt-001/stop')
  })

  it('여러 경로 파라미터를 치환한다', () => {
    const result = buildPath('/projects/{projectId}/runs/{runId}', {
      projectId: 'proj-42',
      runId: 'run-7',
    })
    expect(result).toBe('/projects/proj-42/runs/run-7')
  })

  it('필수 경로 파라미터가 누락되면 에러를 던진다', () => {
    expect(() => buildPath('/loadtests/{id}/stop', {})).toThrow(
      'Missing or empty path parameter: id',
    )
  })

  it('빈 문자열 경로 파라미터는 에러를 던진다', () => {
    // "/users//stop" 같은 깨진 경로를 만들지 않기 위해 빈 문자열은 누락으로 처리한다.
    expect(() => buildPath('/loadtests/{id}/stop', {id: ''})).toThrow(
      'Missing or empty path parameter: id',
    )
  })

  it('숫자 0은 유효한 경로 파라미터로 처리한다', () => {
    const result = buildPath('/items/{id}', {id: 0})
    expect(result).toBe('/items/0')
  })

  it('boolean false도 유효한 경로 파라미터로 처리한다', () => {
    const result = buildPath('/flag/{enabled}', {enabled: false})
    expect(result).toBe('/flag/false')
  })

  it('특수 문자가 포함된 값을 URL 인코딩한다', () => {
    const result = buildPath('/search/{query}', {query: 'hello world'})
    expect(result).toBe('/search/hello%20world')
  })
})

// ── buildQueryParams ──

describe('buildQueryParams', () => {
  it('httpMap이 query인 flag로 쿼리 문자열을 빌드한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'status', httpMap: 'query'},
        {name: 'limit', httpMap: 'query'},
      ],
    })
    const result = buildQueryParams(spec, {status: 'running', limit: 10})
    const params = new URLSearchParams(result)
    expect(params.get('status')).toBe('running')
    expect(params.get('limit')).toBe('10')
  })

  it('httpName이 정의된 경우 해당 이름을 키로 사용한다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'pageSize', httpMap: 'query', httpName: 'page_size'}],
    })
    const result = buildQueryParams(spec, {pageSize: 20})
    const params = new URLSearchParams(result)
    expect(params.get('page_size')).toBe('20')
    expect(params.get('pageSize')).toBeNull()
  })

  it('값이 undefined인 flag는 무시한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'status', httpMap: 'query'},
        {name: 'limit', httpMap: 'query'},
      ],
    })
    const result = buildQueryParams(spec, {status: 'running'})
    const params = new URLSearchParams(result)
    expect(params.get('status')).toBe('running')
    expect(params.has('limit')).toBe(false)
  })

  it('httpMap이 query가 아닌 flag는 무시한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'status', httpMap: 'query'},
        {name: 'name', httpMap: 'body'},
      ],
    })
    const result = buildQueryParams(spec, {status: 'ok', name: 'test'})
    const params = new URLSearchParams(result)
    expect(params.get('status')).toBe('ok')
    expect(params.has('name')).toBe(false)
  })

  it('query flag가 없으면 빈 문자열을 반환한다', () => {
    const spec = makeHttpSpec({flags: []})
    const result = buildQueryParams(spec, {})
    expect(result).toBe('')
  })
})

// ── buildBody ──

describe('buildBody', () => {
  it('httpMap이 body인 flag로 body를 빌드한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'name', httpMap: 'body'},
        {name: 'duration', httpMap: 'body'},
      ],
    })
    const result = buildBody(spec, {name: 'test-run', duration: 60})
    expect(result).toEqual({name: 'test-run', duration: 60})
  })

  it('httpName이 정의된 경우 해당 이름을 키로 사용한다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'maxUsers', httpMap: 'body', httpName: 'max_users'}],
    })
    const result = buildBody(spec, {maxUsers: 100})
    expect(result).toEqual({max_users: 100})
  })

  it('staticBody와 body flag를 병합한다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'rampUp', httpMap: 'body', httpName: 'ramp_up'}],
    })
    const staticBody = {type: 'stress', version: 2}
    const result = buildBody(spec, {rampUp: 30}, staticBody)
    expect(result).toEqual({type: 'stress', version: 2, ramp_up: 30})
  })

  it('body flag가 staticBody의 값을 덮어쓴다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'type', httpMap: 'body'}],
    })
    const staticBody = {type: 'default'}
    const result = buildBody(spec, {type: 'custom'}, staticBody)
    expect(result).toEqual({type: 'custom'})
  })

  it('body flag와 staticBody가 모두 없으면 null을 반환한다', () => {
    const spec = makeHttpSpec({flags: []})
    const result = buildBody(spec, {})
    expect(result).toBeNull()
  })

  it('staticBody만 있을 때 staticBody를 반환한다', () => {
    const spec = makeHttpSpec({flags: []})
    const staticBody = {action: 'stop'}
    const result = buildBody(spec, {}, staticBody)
    expect(result).toEqual({action: 'stop'})
  })
})

// ── applyAuth ──

describe('applyAuth', () => {
  const baseHeaders = {'Content-Type': 'application/json'}

  it('bearer 인증에서 Authorization 헤더를 추가한다', () => {
    const authConfig: AuthConfig = {type: 'bearer'}
    const credentials = {token: 'my-token-123'}
    const result = applyAuth(baseHeaders, authConfig, credentials)
    expect(result).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer my-token-123',
    })
  })

  it('basic 인증에서 base64 인코딩된 Authorization 헤더를 추가한다', () => {
    const authConfig: AuthConfig = {type: 'basic'}
    const credentials = {username: 'admin', password: 'secret'}
    const result = applyAuth(baseHeaders, authConfig, credentials)
    const expected = Buffer.from('admin:secret').toString('base64')
    expect(result).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Basic ${expected}`,
    })
  })

  it('api-key 인증에서 기본 X-API-Key 헤더를 추가한다', () => {
    const authConfig: AuthConfig = {type: 'api-key'}
    const credentials = {token: 'key-abc'}
    const result = applyAuth(baseHeaders, authConfig, credentials)
    expect(result).toEqual({
      'Content-Type': 'application/json',
      'X-API-Key': 'key-abc',
    })
  })

  it('api-key 인증에서 커스텀 headerName을 사용한다', () => {
    const authConfig: AuthConfig = {type: 'api-key', headerName: 'X-Custom-Key'}
    const credentials = {token: 'key-xyz'}
    const result = applyAuth(baseHeaders, authConfig, credentials)
    expect(result).toEqual({
      'Content-Type': 'application/json',
      'X-Custom-Key': 'key-xyz',
    })
  })

  it('jwt 인증은 bearer와 동일하게 처리한다', () => {
    const authConfig: AuthConfig = {type: 'jwt'}
    const credentials = {token: 'jwt-token-456'}
    const result = applyAuth(baseHeaders, authConfig, credentials)
    expect(result).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-token-456',
    })
  })

  it('none 타입은 헤더를 변경하지 않는다', () => {
    const authConfig: AuthConfig = {type: 'none'}
    const result = applyAuth(baseHeaders, authConfig, null)
    expect(result).toEqual({'Content-Type': 'application/json'})
  })

  it('authConfig가 undefined이면 헤더를 변경하지 않는다', () => {
    const result = applyAuth(baseHeaders, undefined, null)
    expect(result).toEqual({'Content-Type': 'application/json'})
  })

  it('원본 headers 객체를 변경하지 않는다 (불변성)', () => {
    const original = {'Content-Type': 'application/json'}
    const authConfig: AuthConfig = {type: 'bearer'}
    const result = applyAuth(original, authConfig, {token: 'tok'})
    expect(original).toEqual({'Content-Type': 'application/json'})
    expect(result).not.toBe(original)
  })

  it('bearer 인증에서 빈 토큰일 때 경고를 출력한다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const authConfig: AuthConfig = {type: 'bearer'}
    applyAuth(baseHeaders, authConfig, {token: ''})
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('token is empty'))
    errorSpy.mockRestore()
  })

  it('basic 인증에서 빈 credential일 때 경고를 출력한다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const authConfig: AuthConfig = {type: 'basic'}
    applyAuth(baseHeaders, authConfig, {username: '', password: ''})
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('credentials are incomplete'))
    errorSpy.mockRestore()
  })

  it('api-key 인증에서 빈 토큰일 때 경고를 출력한다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const authConfig: AuthConfig = {type: 'api-key'}
    applyAuth(baseHeaders, authConfig, null)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('token is empty'))
    errorSpy.mockRestore()
  })
})

// ── coerceBodyValue ──

describe('coerceBodyValue', () => {
  it('json: 유효한 JSON 문자열을 파싱한다', () => {
    const result = coerceBodyValue('{"key":"val","n":1}', 'json')
    expect(result).toEqual({key: 'val', n: 1})
  })

  it('json: JSON 배열 문자열을 파싱한다', () => {
    const result = coerceBodyValue('[1,2,3]', 'json')
    expect(result).toEqual([1, 2, 3])
  })

  it('json: 잘못된 JSON은 원본 문자열을 반환한다', () => {
    const result = coerceBodyValue('not-json', 'json')
    expect(result).toBe('not-json')
  })

  it('json: 비문자열 값은 그대로 통과한다', () => {
    expect(coerceBodyValue(42, 'json')).toBe(42)
    expect(coerceBodyValue(true, 'json')).toBe(true)
  })

  it('array: 콤마 구분 문자열을 배열로 변환한다', () => {
    const result = coerceBodyValue('a, b, c', 'array')
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('array: 단일 값도 배열로 변환한다', () => {
    const result = coerceBodyValue('solo', 'array')
    expect(result).toEqual(['solo'])
  })

  it('number-array: 콤마 구분 문자열을 숫자 배열로 변환한다', () => {
    const result = coerceBodyValue('1, 2, 3', 'number-array')
    expect(result).toEqual([1, 2, 3])
  })

  it('number-array: 비숫자 값은 NaN 경고 후 필터링한다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = coerceBodyValue('1,abc,3', 'number-array')
    expect(result).toEqual([1, 3])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('non-numeric value "abc"'))
    errorSpy.mockRestore()
  })

  it('bodyType이 없으면 값을 그대로 반환한다', () => {
    expect(coerceBodyValue('hello', undefined)).toBe('hello')
    expect(coerceBodyValue(42, undefined)).toBe(42)
  })
})

// ── buildBody with httpBodyType ──

describe('buildBody with httpBodyType', () => {
  it('httpBodyType=json 플래그가 파싱된 JSON 객체로 body에 들어간다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'config', httpMap: 'body', httpBodyType: 'json'}],
    })
    const result = buildBody(spec, {config: '{"scenarios":{"default":"test"}}'})
    expect(result).toEqual({config: {scenarios: {default: 'test'}}})
  })

  it('httpBodyType=array 플래그가 문자열 배열로 body에 들어간다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'tags', httpMap: 'body', httpBodyType: 'array'}],
    })
    const result = buildBody(spec, {tags: 'perf,regression,smoke'})
    expect(result).toEqual({tags: ['perf', 'regression', 'smoke']})
  })

  it('httpBodyType=number-array 플래그가 숫자 배열로 body에 들어간다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'body', httpBodyType: 'number-array'}],
    })
    const result = buildBody(spec, {ids: '1,2,3'})
    expect(result).toEqual({ids: [1, 2, 3]})
  })

  it('여러 httpBodyType이 혼합된 body를 올바르게 빌드한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'name', httpMap: 'body'},
        {name: 'config', httpMap: 'body', httpBodyType: 'json'},
        {name: 'tags', httpMap: 'body', httpBodyType: 'array'},
        {name: 'ids', httpMap: 'body', httpBodyType: 'number-array'},
      ],
    })
    const result = buildBody(spec, {
      name: 'test',
      config: '{"key":"val"}',
      tags: 'a,b',
      ids: '10,20',
    })
    expect(result).toEqual({
      name: 'test',
      config: {key: 'val'},
      tags: ['a', 'b'],
      ids: [10, 20],
    })
  })
})

// ── buildPath 추가 테스트 ──

describe('buildPath 추가', () => {
  it('하이픈이 포함된 경로 파라미터를 치환한다', () => {
    const result = buildPath('/users/{user-id}/posts/{post-id}', {
      'user-id': 'u-42',
      'post-id': 'p-7',
    })
    expect(result).toBe('/users/u-42/posts/p-7')
  })
})

// ── buildHeaders ──

describe('buildHeaders', () => {
  it('httpMap이 header인 flag로 헤더 객체를 빌드한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'trace-id', httpMap: 'header', httpName: 'X-Trace-Id'},
        {name: 'idempotency', httpMap: 'header', httpName: 'X-Idempotency-Key'},
      ],
    })
    const result = buildHeaders(spec, {'trace-id': 'tr-1', idempotency: 'idem-2'})
    expect(result).toEqual({'X-Trace-Id': 'tr-1', 'X-Idempotency-Key': 'idem-2'})
  })

  it('httpName이 없으면 flag 이름을 헤더 이름으로 사용한다', () => {
    const spec = makeHttpSpec({flags: [{name: 'X-Custom', httpMap: 'header'}]})
    const result = buildHeaders(spec, {'X-Custom': 'foo'})
    expect(result).toEqual({'X-Custom': 'foo'})
  })

  it('httpMap이 header가 아닌 flag는 무시한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'X-A', httpMap: 'header'},
        {name: 'q', httpMap: 'query'},
        {name: 'b', httpMap: 'body'},
      ],
    })
    const result = buildHeaders(spec, {'X-A': '1', q: '2', b: '3'})
    expect(result).toEqual({'X-A': '1'})
  })

  it('undefined/null 값인 flag는 스킵한다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'X-A', httpMap: 'header'},
        {name: 'X-B', httpMap: 'header'},
      ],
    })
    const result = buildHeaders(spec, {'X-A': undefined, 'X-B': 'ok'})
    expect(result).toEqual({'X-B': 'ok'})
  })

  it('header flag가 없으면 빈 객체를 반환한다', () => {
    const spec = makeHttpSpec({flags: []})
    expect(buildHeaders(spec, {})).toEqual({})
  })
})

// ── buildQueryParams 배열 지원 ──

describe('buildQueryParams — 배열 값', () => {
  it('배열 값은 기본적으로 반복 키(repeat)로 직렬화한다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'query'}],
    })
    const result = buildQueryParams(spec, {ids: ['1', '2', '3']})
    // append 순서 보장
    expect(result).toBe('ids=1&ids=2&ids=3')
  })

  it('httpQueryType=csv 이면 콤마로 합쳐서 전송한다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'query', httpQueryType: 'csv'}],
    })
    const result = buildQueryParams(spec, {ids: ['1', '2', '3']})
    expect(result).toBe('ids=1%2C2%2C3')
  })

  it('배열 내 undefined/null 원소는 무시한다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'query'}],
    })
    const result = buildQueryParams(spec, {ids: ['a', undefined, 'b', null]})
    expect(result).toBe('ids=a&ids=b')
  })

  it('httpQueryType이 있고 값이 문자열이면 콤마 split 후 repeat로 전송한다 (CLI 입력 호환)', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'query', httpQueryType: 'repeat'}],
    })
    const result = buildQueryParams(spec, {ids: '1,2,3'})
    expect(result).toBe('ids=1&ids=2&ids=3')
  })

  it('httpQueryType=csv이고 값이 문자열이면 그대로 CSV로 전송한다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'query', httpQueryType: 'csv'}],
    })
    const result = buildQueryParams(spec, {ids: '1, 2, 3'})
    // trim 후 csv join
    expect(result).toBe('ids=1%2C2%2C3')
  })

  it('httpQueryType이 없으면 문자열을 split하지 않고 그대로 전송한다 (하위 호환)', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'query'}],
    })
    const result = buildQueryParams(spec, {ids: '1,2,3'})
    expect(result).toBe('ids=1%2C2%2C3')
  })

  it('빈 배열 값이면 해당 query 파라미터를 전혀 추가하지 않는다', () => {
    const spec = makeHttpSpec({
      flags: [
        {name: 'ids', httpMap: 'query'},
        {name: 'status', httpMap: 'query'},
      ],
    })
    const result = buildQueryParams(spec, {ids: [], status: 'active'})
    // ids는 빈 배열이므로 아예 key가 없어야 한다.
    expect(result).toBe('status=active')
  })

  it('httpQueryType=repeat + 빈 문자열 입력은 어떤 key도 추가하지 않는다', () => {
    const spec = makeHttpSpec({
      flags: [{name: 'ids', httpMap: 'query', httpQueryType: 'repeat'}],
    })
    const result = buildQueryParams(spec, {ids: ''})
    expect(result).toBe('')
  })
})

// ── resolveEndpointUrl ──

describe('resolveEndpointUrl', () => {
  it('상대 경로는 baseUrl과 결합한다', () => {
    expect(resolveEndpointUrl('http://api/v1', '/login')).toBe('http://api/v1/login')
  })

  it('절대 URL(http)은 baseUrl을 무시하고 그대로 사용한다', () => {
    expect(resolveEndpointUrl('http://api/v1', 'http://auth.example.com/login')).toBe(
      'http://auth.example.com/login',
    )
  })

  it('절대 URL(https)은 baseUrl을 무시하고 그대로 사용한다', () => {
    expect(resolveEndpointUrl('http://api/v1', 'https://auth.example.com/login')).toBe(
      'https://auth.example.com/login',
    )
  })

  it('대소문자 무시로 프로토콜을 매칭한다', () => {
    expect(resolveEndpointUrl('http://api/v1', 'HTTPS://x.example/')).toBe('HTTPS://x.example/')
  })

  it('baseUrl의 trailing slash와 endpoint의 leading slash가 중복되어도 //가 생기지 않는다', () => {
    expect(resolveEndpointUrl('http://api/v1/', '/login')).toBe('http://api/v1/login')
  })

  it('endpoint가 leading slash 없이 시작해도 /가 보장된다', () => {
    expect(resolveEndpointUrl('http://api/v1', 'login')).toBe('http://api/v1/login')
  })

  it('baseUrl trailing slash + slashless endpoint 조합도 정상 처리한다', () => {
    expect(resolveEndpointUrl('http://api/v1/', 'login')).toBe('http://api/v1/login')
  })

  it('endpoint의 중복 leading slash는 하나로 정규화된다', () => {
    expect(resolveEndpointUrl('http://api/v1', '///login')).toBe('http://api/v1/login')
  })
})

// ── coerceBodyValue — JSON 실패 경고 (H5) ──

describe('coerceBodyValue JSON 실패 경고', () => {
  it('json 파싱 실패 시 logger.warn으로 경고를 출력한다', () => {
    // logger.warn을 직접 mock해서 console 구현 변경에 영향받지 않게 한다.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    coerceBodyValue('not-json', 'json')
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]?.[0]).toContain('not valid JSON')
    warnSpy.mockRestore()
  })

  it('긴 값은 잘라서 경고 메시지에 포함한다', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const long = 'x'.repeat(200)
    coerceBodyValue(long, 'json')
    const msg = warnSpy.mock.calls[0]?.[0] ?? ''
    expect(msg).toContain('...')
    expect(msg.length).toBeLessThan(200)
    warnSpy.mockRestore()
  })
})

// ── applyAuth — cookie 매칭 개선 (H1, M4, L2) ──

describe('applyAuth — cookie', () => {
  it('cookieName이 지정되면 정확히 그 이름의 쿠키 값을 Bearer로 사용한다', () => {
    const authConfig: AuthConfig = {type: 'cookie', cookieName: 'lona_token'}
    const cookies = 'other=abc; lona_token=eyJhbGciOi.payloadpart.signaturepart; lona_refresh_token=refresh123'
    const result = applyAuth({}, authConfig, {cookies})
    expect(result.Authorization).toBe('Bearer eyJhbGciOi.payloadpart.signaturepart')
  })

  it('serviceName이 지정되면 ${serviceName}_token 쿠키에서 Bearer를 추출한다', () => {
    const authConfig: AuthConfig = {type: 'cookie', serviceName: 'lona'}
    const cookies = 'foo=bar; lona_token=eyJhbGci.payload.sig; lona_refresh_token=xyz'
    const result = applyAuth({}, authConfig, {cookies})
    expect(result.Authorization).toBe('Bearer eyJhbGci.payload.sig')
  })

  it('fallback: cookieName/serviceName이 없으면 *_token 쿠키를 선택한다 (refresh_token 제외)', () => {
    const authConfig: AuthConfig = {type: 'cookie'}
    const cookies = 'session_token=eyJx.yy.zz; refresh_token=rrr'
    const result = applyAuth({}, authConfig, {cookies})
    expect(result.Authorization).toBe('Bearer eyJx.yy.zz')
  })

  it('공백 없는 세미콜론 구분자도 처리한다', () => {
    const authConfig: AuthConfig = {type: 'cookie', cookieName: 'x_token'}
    const cookies = 'a=1;x_token=eyJa.b.c;y=2'
    const result = applyAuth({}, authConfig, {cookies})
    expect(result.Authorization).toBe('Bearer eyJa.b.c')
  })

  it('비ASCII 바이트는 토큰 쿠키 값에서만 제거되며 다른 쿠키 값은 보존된다', () => {
    const authConfig: AuthConfig = {type: 'cookie', cookieName: 'svc_token'}
    // svc_token 앞에 비ASCII 프리픽스가 있고, locale 쿠키에는 한글이 있다.
    const cookies = 'locale=한국어; svc_token=\u0003\u0005eyJh.b.c'
    const result = applyAuth({}, authConfig, {cookies})
    expect(result.Authorization).toBe('Bearer eyJh.b.c')
    // Cookie 헤더에서 locale 값은 원본 그대로 유지되어야 한다.
    expect(result.Cookie).toContain('locale=한국어')
    // svc_token 값은 비ASCII 제거된 형태여야 한다.
    expect(result.Cookie).toContain('svc_token=eyJh.b.c')
  })

  it('cookies에 매칭되는 토큰이 없으면 경고 + Cookie 헤더만 설정한다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const authConfig: AuthConfig = {type: 'cookie', cookieName: 'missing_token'}
    const result = applyAuth({}, authConfig, {cookies: 'foo=bar'})
    expect(result.Authorization).toBeUndefined()
    expect(result.Cookie).toBe('foo=bar')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('could not locate a token cookie'))
    errorSpy.mockRestore()
  })
})

// ── applyAuth — 빈 토큰일 때 Authorization 생성 안함 (C3) ──

describe('applyAuth — 빈 토큰/credential은 Authorization 헤더를 생성하지 않는다', () => {
  it('bearer: 빈 토큰이면 Authorization 헤더가 없다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = applyAuth({}, {type: 'bearer'}, {token: ''})
    expect(result.Authorization).toBeUndefined()
    errorSpy.mockRestore()
  })

  it('jwt: 빈 토큰이면 Authorization 헤더가 없다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = applyAuth({}, {type: 'jwt'}, {token: ''})
    expect(result.Authorization).toBeUndefined()
    errorSpy.mockRestore()
  })

  it('api-key: 빈 토큰이면 X-API-Key 헤더가 없다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = applyAuth({}, {type: 'api-key'}, {token: ''})
    expect(result['X-API-Key']).toBeUndefined()
    errorSpy.mockRestore()
  })

  it('basic: username/password 일부라도 비어있으면 Authorization 헤더가 없다', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = applyAuth({}, {type: 'basic'}, {username: 'u', password: ''})
    expect(result.Authorization).toBeUndefined()
    errorSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Retry policy
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRetryConfig', () => {
  it('빈/undefined 입력은 attempts=1 (기본 no-retry) 로 정규화된다', () => {
    const cfg = normalizeRetryConfig(undefined)
    expect(cfg.attempts).toBe(1)
    expect(cfg.initialDelayMs).toBe(200)
    expect(cfg.maxDelayMs).toBe(5000)
    expect(cfg.respectRetryAfter).toBe(true)
    expect(cfg.jitter).toBe('full')
    expect(cfg.idempotent).toBe('auto')
    expect([...cfg.retryOn]).toEqual([429, 500, 502, 503, 504])
  })

  it('전체 필드가 있는 경우 그대로 사용한다', () => {
    const cfg = normalizeRetryConfig({
      attempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      retryOn: [503, 504],
      respectRetryAfter: false,
      jitter: 'none',
      idempotent: true,
    })
    expect(cfg.attempts).toBe(5)
    expect(cfg.initialDelayMs).toBe(100)
    expect(cfg.maxDelayMs).toBe(1000)
    expect([...cfg.retryOn].sort()).toEqual([503, 504])
    expect(cfg.respectRetryAfter).toBe(false)
    expect(cfg.jitter).toBe('none')
    expect(cfg.idempotent).toBe(true)
  })

  it('attempts < 1 은 1로 보정된다', () => {
    const cfg = normalizeRetryConfig({attempts: 0})
    expect(cfg.attempts).toBe(1)
  })

  it('maxDelayMs < initialDelayMs 면 initialDelayMs 로 보정된다', () => {
    const cfg = normalizeRetryConfig({initialDelayMs: 1000, maxDelayMs: 100})
    expect(cfg.maxDelayMs).toBe(1000)
  })

  it('잘못된 jitter 값은 full 로 폴백한다', () => {
    // 사용자가 'random' 같은 잘못된 enum 을 줬을 때 — 정규화는 안전한 기본값으로
    const cfg = normalizeRetryConfig({jitter: 'random' as 'full'})
    expect(cfg.jitter).toBe('full')
  })

  it('빈 retryOn 배열은 default 로 폴백한다', () => {
    const cfg = normalizeRetryConfig({retryOn: []})
    expect([...cfg.retryOn].sort((a, b) => a - b)).toEqual([429, 500, 502, 503, 504])
  })
})

describe('parseRetryAfter', () => {
  it('정수(seconds) 헤더를 ms 로 변환한다', () => {
    expect(parseRetryAfter('1')).toBe(1000)
    expect(parseRetryAfter('30')).toBe(30000)
  })

  it('HTTP-date 형식을 미래 시점까지의 ms 로 변환한다', () => {
    const now = Date.now()
    const future = new Date(now + 5000).toUTCString()
    const result = parseRetryAfter(future, now)
    // toUTCString 의 초 단위 반올림 때문에 약간의 오차 허용
    expect(result).not.toBeNull()
    expect(result!).toBeGreaterThanOrEqual(0)
    expect(result!).toBeLessThanOrEqual(5000)
  })

  it('과거 시점은 0으로 clamp 된다', () => {
    const now = Date.now()
    const past = new Date(now - 5000).toUTCString()
    expect(parseRetryAfter(past, now)).toBe(0)
  })

  it('null/빈/잘못된 값은 null 을 반환한다', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
    expect(parseRetryAfter('   ')).toBeNull()
    expect(parseRetryAfter('not-a-date')).toBeNull()
  })
})

describe('computeBackoffMs', () => {
  it('jitter=none 이면 deterministic 한 exponential 값을 반환한다', () => {
    const cfg = {initialDelayMs: 100, maxDelayMs: 5000, jitter: 'none' as const}
    expect(computeBackoffMs(1, cfg)).toBe(100)
    expect(computeBackoffMs(2, cfg)).toBe(200)
    expect(computeBackoffMs(3, cfg)).toBe(400)
    expect(computeBackoffMs(4, cfg)).toBe(800)
  })

  it('maxDelayMs 로 cap 된다', () => {
    const cfg = {initialDelayMs: 100, maxDelayMs: 300, jitter: 'none' as const}
    // 100 * 2^3 = 800 → 300 cap
    expect(computeBackoffMs(4, cfg)).toBe(300)
    expect(computeBackoffMs(10, cfg)).toBe(300)
  })

  it('jitter=full 이면 0 ~ delay 범위에서 무작위', () => {
    const cfg = {initialDelayMs: 100, maxDelayMs: 5000, jitter: 'full' as const}
    // rng=0 → 0, rng=0.999 → near 200
    expect(computeBackoffMs(2, cfg, () => 0)).toBe(0)
    expect(computeBackoffMs(2, cfg, () => 0.5)).toBe(100)
  })

  it('jitter=equal 이면 delay/2 ~ delay 범위', () => {
    const cfg = {initialDelayMs: 100, maxDelayMs: 5000, jitter: 'equal' as const}
    expect(computeBackoffMs(2, cfg, () => 0)).toBe(100)   // 200/2 + 0
    expect(computeBackoffMs(2, cfg, () => 1)).toBe(200)   // 200/2 + 200/2
  })
})

describe('isMethodRetryable', () => {
  it('idempotent=false 면 모든 메서드를 거부한다', () => {
    expect(isMethodRetryable('GET', false)).toBe(false)
    expect(isMethodRetryable('POST', false)).toBe(false)
  })

  it('idempotent=true 면 모든 메서드를 허용한다', () => {
    expect(isMethodRetryable('GET', true)).toBe(true)
    expect(isMethodRetryable('POST', true)).toBe(true)
  })

  it('idempotent=auto 면 GET/HEAD/PUT/DELETE 만 허용한다', () => {
    expect(isMethodRetryable('GET', 'auto')).toBe(true)
    expect(isMethodRetryable('HEAD', 'auto')).toBe(true)
    expect(isMethodRetryable('PUT', 'auto')).toBe(true)
    expect(isMethodRetryable('DELETE', 'auto')).toBe(true)
    expect(isMethodRetryable('POST', 'auto')).toBe(false)
    expect(isMethodRetryable('PATCH', 'auto')).toBe(false)
  })

  it('소문자 메서드도 정확히 매칭한다', () => {
    expect(isMethodRetryable('get', 'auto')).toBe(true)
    expect(isMethodRetryable('post', 'auto')).toBe(false)
  })
})

// ── fetchWithRetry: 시나리오 ──

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json', ...headers},
  })
}

describe('fetchWithRetry', () => {
  it('case 1: 503 → 200 — attempts=3, retryOn=[503] 이면 1회 재시도 후 성공한다', async () => {
    const calls: number[] = []
    const fakeFetch = vi.fn(async () => {
      calls.push(Date.now())
      if (calls.length === 1) return jsonResponse(503, {error: 'unavailable'})
      return jsonResponse(200, {ok: true})
    })
    const cfg = normalizeRetryConfig({attempts: 3, retryOn: [503], jitter: 'none', initialDelayMs: 1})
    const sleeps: number[] = []
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(res.status).toBe(200)
    expect(fakeFetch).toHaveBeenCalledTimes(2)
    expect(sleeps).toHaveLength(1)
  })

  it('case 2: 모든 attempts 가 503 이면 마지막 응답을 반환한다 (호출자가 HTTP_503 처리)', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(503, {error: 'down'}))
    const cfg = normalizeRetryConfig({attempts: 3, retryOn: [503], jitter: 'none', initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(503)
    expect(fakeFetch).toHaveBeenCalledTimes(3)
  })

  it('case 3: Retry-After (seconds) 헤더가 backoff 보다 우선 적용된다', async () => {
    const fakeFetch = vi.fn(async () => {
      if (fakeFetch.mock.calls.length === 1) {
        return jsonResponse(429, {error: 'too many'}, {'Retry-After': '2'})
      }
      return jsonResponse(200, {ok: true})
    })
    const cfg = normalizeRetryConfig({
      attempts: 3,
      retryOn: [429],
      jitter: 'none',
      initialDelayMs: 50,
      maxDelayMs: 5000,
      respectRetryAfter: true,
    })
    const sleeps: number[] = []
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(res.status).toBe(200)
    // Retry-After: 2 → 2000ms (initialDelayMs=50 인 backoff 와는 다름)
    expect(sleeps).toEqual([2000])
  })

  it('case 3b: respectRetryAfter=false 면 헤더 무시하고 backoff 만 사용한다', async () => {
    const fakeFetch = vi.fn(async () => {
      if (fakeFetch.mock.calls.length === 1) {
        return jsonResponse(429, {error: 'too many'}, {'Retry-After': '5'})
      }
      return jsonResponse(200, {ok: true})
    })
    const cfg = normalizeRetryConfig({
      attempts: 3,
      retryOn: [429],
      jitter: 'none',
      initialDelayMs: 100,
      respectRetryAfter: false,
    })
    const sleeps: number[] = []
    await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(sleeps).toEqual([100])
  })

  it('case 4: 네트워크 에러 (fetch reject) 도 retry 한다', async () => {
    const fakeFetch = vi.fn(async () => {
      if (fakeFetch.mock.calls.length === 1) throw new Error('network failure')
      return jsonResponse(200, {ok: true})
    })
    const cfg = normalizeRetryConfig({attempts: 3, jitter: 'none', initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(200)
    expect(fakeFetch).toHaveBeenCalledTimes(2)
  })

  it('case 4b: AbortError 도 동일하게 retry 된다', async () => {
    const fakeFetch = vi.fn(async () => {
      if (fakeFetch.mock.calls.length === 1) {
        const err = new Error('aborted')
        err.name = 'AbortError'
        throw err
      }
      return jsonResponse(200, {ok: true})
    })
    const cfg = normalizeRetryConfig({attempts: 3, jitter: 'none', initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(200)
  })

  it('case 4c: 모든 attempts 가 네트워크 에러면 최종 throw 한다', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('net down')
    })
    const cfg = normalizeRetryConfig({attempts: 3, jitter: 'none', initialDelayMs: 1})
    await expect(
      fetchWithRetry('http://x/y', {}, cfg, 'GET', {
        fetchImpl: fakeFetch as unknown as typeof fetch,
        sleep: async () => {},
      }),
    ).rejects.toThrow('net down')
    expect(fakeFetch).toHaveBeenCalledTimes(3)
  })

  it('case 5: idempotent=false 면 POST 도 retry 안 한다', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(503, {}))
    const cfg = normalizeRetryConfig({attempts: 3, retryOn: [503], idempotent: false, initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'POST', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(503)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('case 6a: idempotent=auto + GET 은 retry 한다', async () => {
    const fakeFetch = vi.fn(async () => {
      if (fakeFetch.mock.calls.length === 1) return jsonResponse(503, {})
      return jsonResponse(200, {ok: true})
    })
    const cfg = normalizeRetryConfig({attempts: 3, retryOn: [503], idempotent: 'auto', initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(200)
    expect(fakeFetch).toHaveBeenCalledTimes(2)
  })

  it('case 6b: idempotent=auto + POST 는 retry 안 한다', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(503, {}))
    const cfg = normalizeRetryConfig({attempts: 3, retryOn: [503], idempotent: 'auto', initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'POST', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(503)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('case 7: retry config 미지정 시 default attempts=1 — 한 번만 호출하고 반환', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(503, {}))
    const cfg = normalizeRetryConfig(undefined) // attempts=1
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(503)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('case 8: jitter=none + initialDelayMs=100 일 때 정확히 100, 200, 400 ms 슬립한다', async () => {
    let attempts = 0
    const fakeFetch = vi.fn(async () => {
      attempts++
      if (attempts < 4) return jsonResponse(503, {})
      return jsonResponse(200, {ok: true})
    })
    const cfg = normalizeRetryConfig({
      attempts: 4,
      retryOn: [503],
      jitter: 'none',
      initialDelayMs: 100,
      maxDelayMs: 5000,
    })
    const sleeps: number[] = []
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(res.status).toBe(200)
    // attempt 1 fail → backoff(1)=100, attempt 2 fail → backoff(2)=200, attempt 3 fail → backoff(3)=400
    expect(sleeps).toEqual([100, 200, 400])
  })

  it('401 응답은 retry 정책 미적용 — 즉시 반환된다 (auth-handlers 영역)', async () => {
    // retryOn 에 401 을 명시적으로 추가했더라도 retry 하지 않는다.
    const fakeFetch = vi.fn(async () => jsonResponse(401, {error: 'unauthorized'}))
    const cfg = normalizeRetryConfig({attempts: 3, retryOn: [401, 503], jitter: 'none', initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(401)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('retryOn 에 없는 status (예: 400) 는 즉시 반환', async () => {
    const fakeFetch = vi.fn(async () => jsonResponse(400, {error: 'bad request'}))
    const cfg = normalizeRetryConfig({attempts: 3, retryOn: [503], initialDelayMs: 1})
    const res = await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async () => {},
    })
    expect(res.status).toBe(400)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('Retry-After 가 maxDelayMs 보다 크면 cap 된다', async () => {
    const fakeFetch = vi.fn(async () => {
      if (fakeFetch.mock.calls.length === 1) {
        return jsonResponse(429, {}, {'Retry-After': '100'}) // 100s = 100000ms
      }
      return jsonResponse(200, {})
    })
    const cfg = normalizeRetryConfig({
      attempts: 3,
      retryOn: [429],
      jitter: 'none',
      initialDelayMs: 50,
      maxDelayMs: 1000,
    })
    const sleeps: number[] = []
    await fetchWithRetry('http://x/y', {}, cfg, 'GET', {
      fetchImpl: fakeFetch as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(sleeps).toEqual([1000])
  })
})
