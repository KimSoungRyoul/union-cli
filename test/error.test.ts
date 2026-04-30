import {describe, it, expect} from 'vitest'
import {UnifiedError, formatError, exitCodeFromError} from '../src/core/error.js'

describe('UnifiedError', () => {
  it('code, message, details를 가진다', () => {
    const err = new UnifiedError('TEST_ERROR', 'something failed', {hint: 'retry'})
    expect(err.code).toBe('TEST_ERROR')
    expect(err.message).toBe('something failed')
    expect(err.details).toEqual({hint: 'retry'})
    expect(err.name).toBe('UnifiedError')
    expect(err).toBeInstanceOf(Error)
  })

  it('details는 선택적이다', () => {
    const err = new UnifiedError('ERR', 'msg')
    expect(err.details).toBeUndefined()
  })
})

describe('formatError', () => {
  it('debug=false일 때 사용자 친화적 메시지를 반환한다', () => {
    const err = new UnifiedError('PROVIDER_TIMEOUT', 'request timed out')
    const result = formatError(err, false)
    expect(result).toBe('Error: request timed out')
    expect(result).not.toContain('stack')
  })

  it('debug=false일 때 USAGE_ 코드에 대해 suggestion을 포함한다', () => {
    const err = new UnifiedError('USAGE_MISSING_ARG', 'missing required argument')
    const result = formatError(err, false)
    expect(result).toContain('Error: missing required argument')
    expect(result).toContain('Run with --help')
  })

  it('debug=true일 때 코드, 메시지, 스택을 모두 포함한다', () => {
    const err = new UnifiedError('TEST_ERROR', 'boom', {extra: 1})
    const result = formatError(err, true)
    expect(result).toContain('Error [TEST_ERROR]: boom')
    expect(result).toContain('"extra": 1')
    expect(result).toContain('at ')  // stack trace
  })
})

describe('exitCodeFromError', () => {
  it('USAGE_ 접두사 에러는 exit code 2를 반환한다', () => {
    const err = new UnifiedError('USAGE_MISSING_ARG', 'missing arg')
    expect(exitCodeFromError(err)).toBe(2)
  })

  it('USAGE_INVALID_FLAG도 exit code 2를 반환한다', () => {
    const err = new UnifiedError('USAGE_INVALID_FLAG', 'bad flag')
    expect(exitCodeFromError(err)).toBe(2)
  })

  it('다른 에러는 exit code 1을 반환한다', () => {
    const err = new UnifiedError('PROVIDER_ERROR', 'failed')
    expect(exitCodeFromError(err)).toBe(1)
  })

  it('일반 에러도 exit code 1을 반환한다', () => {
    const err = new UnifiedError('UNKNOWN', 'unknown error')
    expect(exitCodeFromError(err)).toBe(1)
  })
})

// ── UnifiedError 추가 테스트 ──

describe('UnifiedError — 모든 필드 채워진 경우', () => {
  it('code, message, details가 모두 채워진 인스턴스를 생성한다', () => {
    const details = {
      requestId: 'req-abc-123',
      statusCode: 500,
      headers: {'x-request-id': 'req-abc-123'},
      body: {error: 'internal server error'},
    }
    const err = new UnifiedError('HTTP_500', 'Internal Server Error', details)

    expect(err.code).toBe('HTTP_500')
    expect(err.message).toBe('Internal Server Error')
    expect(err.details).toEqual(details)
    expect(err.name).toBe('UnifiedError')
    expect(err).toBeInstanceOf(Error)
    expect(err.stack).toBeDefined()
    expect(err.stack).toContain('UnifiedError')
  })

  it('details가 배열인 경우도 저장한다', () => {
    const err = new UnifiedError('VALIDATION_ERROR', 'multiple errors', [
      {field: 'name', message: 'required'},
      {field: 'email', message: 'invalid format'},
    ])
    expect(Array.isArray(err.details)).toBe(true)
    expect((err.details as unknown[]).length).toBe(2)
  })

  it('details가 문자열인 경우도 저장한다', () => {
    const err = new UnifiedError('SIMPLE_ERROR', 'oops', 'extra context string')
    expect(err.details).toBe('extra context string')
  })

  it('details가 null인 경우도 저장한다', () => {
    const err = new UnifiedError('NULL_DETAIL', 'with null', null)
    expect(err.details).toBeNull()
  })
})

describe('formatError — 추가 케이스', () => {
  it('USAGE_INVALID_FLAG 코드에 대해 올바른 suggestion을 포함한다', () => {
    const err = new UnifiedError('USAGE_INVALID_FLAG', 'unknown flag --xyz')
    const result = formatError(err, false)
    expect(result).toContain('Error: unknown flag --xyz')
    expect(result).toContain('Run with --help to see available flags.')
  })

  it('USAGE_UNKNOWN_COMMAND 코드에 대해 올바른 suggestion을 포함한다', () => {
    const err = new UnifiedError('USAGE_UNKNOWN_COMMAND', 'unknown command "foobar"')
    const result = formatError(err, false)
    expect(result).toContain('Error: unknown command "foobar"')
    expect(result).toContain('Run without arguments to see available commands.')
  })

  it('suggestion이 없는 코드는 suggestion 줄이 없다', () => {
    const err = new UnifiedError('NETWORK_ERROR', 'connection refused')
    const result = formatError(err, false)
    expect(result).toBe('Error: connection refused')
    // Should not have extra lines
    expect(result.split('\n')).toHaveLength(1)
  })

  it('debug=true, details가 없을 때 Details 줄이 없다', () => {
    const err = new UnifiedError('SIMPLE', 'no details')
    const result = formatError(err, true)
    expect(result).toContain('Error [SIMPLE]: no details')
    expect(result).not.toContain('Details:')
  })

  it('debug=true, details가 있을 때 JSON 직렬화된 details를 포함한다', () => {
    const err = new UnifiedError('DB_ERROR', 'query failed', {table: 'users', query: 'SELECT *'})
    const result = formatError(err, true)
    expect(result).toContain('Error [DB_ERROR]: query failed')
    expect(result).toContain('"table": "users"')
    expect(result).toContain('"query": "SELECT *"')
  })
})

describe('exitCodeFromError — 추가 케이스', () => {
  it('USAGE_UNKNOWN_COMMAND도 exit code 2를 반환한다', () => {
    const err = new UnifiedError('USAGE_UNKNOWN_COMMAND', 'not found')
    expect(exitCodeFromError(err)).toBe(2)
  })

  it('USAGE_ 접두사가 아닌 USER_ 코드는 exit code 1을 반환한다', () => {
    const err = new UnifiedError('USER_CANCELLED', 'cancelled by user')
    expect(exitCodeFromError(err)).toBe(1)
  })

  it('빈 문자열 코드는 exit code 1을 반환한다', () => {
    const err = new UnifiedError('', 'empty code')
    expect(exitCodeFromError(err)).toBe(1)
  })
})
