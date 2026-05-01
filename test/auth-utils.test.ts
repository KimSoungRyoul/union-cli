import {describe, it, expect, beforeEach, afterEach} from 'vitest'

import {resolveEnvVars} from '../src/core/auth-utils.js'

describe('resolveEnvVars', () => {
  const originalEnv = {...process.env}

  beforeEach(() => {
    // 테스트 격리 — 외부 env 의 영향을 받지 않도록 알려진 키 정리
    delete process.env.MY_TEST_VAR
    delete process.env.AEROCM_ENDPOINT_URL
    delete process.env.NESTED_KEY
  })

  afterEach(() => {
    process.env = {...originalEnv}
  })

  describe('legacy: env-only', () => {
    it('정의된 env var 를 치환한다', () => {
      process.env.MY_TEST_VAR = 'hello'
      expect(resolveEnvVars('value=${MY_TEST_VAR}')).toBe('value=hello')
    })

    it('미정의 env var 는 빈 문자열로 치환', () => {
      expect(resolveEnvVars('${UNDEFINED}')).toBe('')
    })

    it(':- 으로 default 를 지정한다', () => {
      expect(resolveEnvVars('${UNDEFINED:-fallback}')).toBe('fallback')
    })

    it('env 가 있으면 default 보다 우선', () => {
      process.env.MY_TEST_VAR = 'real'
      expect(resolveEnvVars('${MY_TEST_VAR:-fallback}')).toBe('real')
    })

    it('placeholder 가 없는 문자열은 그대로 반환', () => {
      expect(resolveEnvVars('plain text')).toBe('plain text')
    })

    it('한 문자열에 여러 placeholder', () => {
      process.env.MY_TEST_VAR = 'A'
      expect(resolveEnvVars('${MY_TEST_VAR}-${UNDEFINED:-B}')).toBe('A-B')
    })
  })

  describe('config: ${@key} 문법', () => {
    it('config 값을 치환한다', () => {
      const cfg = {endpointUrl: 'http://config-url'}
      expect(resolveEnvVars('${@endpointUrl}', cfg)).toBe('http://config-url')
    })

    it('미정의 config 키는 빈 문자열', () => {
      expect(resolveEnvVars('${@missing}', {})).toBe('')
    })

    it('config + default fallback', () => {
      expect(resolveEnvVars('${@missing:-fallback}', {})).toBe('fallback')
    })

    it('config 값이 default 보다 우선', () => {
      expect(resolveEnvVars('${@k:-default}', {k: 'config-val'})).toBe('config-val')
    })

    it('config 값이 비어있으면 default 사용', () => {
      expect(resolveEnvVars('${@k:-default}', {k: ''})).toBe('default')
    })

    it('숫자/불리언 config 값은 String() 으로 변환', () => {
      expect(resolveEnvVars('${@port}', {port: 8080})).toBe('8080')
      expect(resolveEnvVars('${@flag}', {flag: true})).toBe('true')
    })

    it('configValues 인자 미전달이면 모든 ${@k} 가 빈 문자열', () => {
      expect(resolveEnvVars('${@anything:-x}')).toBe('x')
    })
  })

  describe('중첩 placeholder', () => {
    it('${ENV:-${@cfg:-default}} — env 우선', () => {
      process.env.AEROCM_ENDPOINT_URL = 'http://from-env'
      const cfg = {endpointUrl: 'http://from-config'}
      expect(
        resolveEnvVars('${AEROCM_ENDPOINT_URL:-${@endpointUrl:-http://default}}', cfg),
      ).toBe('http://from-env')
    })

    it('${ENV:-${@cfg:-default}} — env 미정 시 config 사용', () => {
      const cfg = {endpointUrl: 'http://from-config'}
      expect(
        resolveEnvVars('${AEROCM_ENDPOINT_URL:-${@endpointUrl:-http://default}}', cfg),
      ).toBe('http://from-config')
    })

    it('${ENV:-${@cfg:-default}} — env/config 둘 다 미정 시 default 사용', () => {
      expect(
        resolveEnvVars('${AEROCM_ENDPOINT_URL:-${@endpointUrl:-http://default}}', {}),
      ).toBe('http://default')
    })

    it('중첩이 좌변(key)에 있어도 동작', () => {
      // ${${A}_VAR} 같은 동적 키 형태
      process.env.PREFIX = 'MY_TEST'
      process.env.MY_TEST_VAR = 'resolved'
      expect(resolveEnvVars('${${PREFIX}_VAR}')).toBe('resolved')
    })
  })

  describe('edge cases', () => {
    it('닫히지 않은 ${ 는 원문 유지', () => {
      expect(resolveEnvVars('prefix-${UNCLOSED')).toBe('prefix-${UNCLOSED')
    })

    it('빈 placeholder ${} 는 빈 문자열', () => {
      expect(resolveEnvVars('${}')).toBe('')
    })

    it('연속 placeholder', () => {
      process.env.A = '1'
      process.env.B = '2'
      expect(resolveEnvVars('${A}${B}')).toBe('12')
    })
  })
})
