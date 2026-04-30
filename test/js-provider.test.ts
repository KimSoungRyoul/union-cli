import {describe, it, expect} from 'vitest'
import {callFunction} from '../src/providers/js/loader.js'
import {JSProvider} from '../src/providers/js/provider.js'
import type {CommandSpec, ExecutionInput, JsCommandConfig} from '../src/core/types.js'

// ── callFunction ──

describe('callFunction', () => {
  it('모듈 객체에서 함수를 올바르게 호출한다', async () => {
    const mod: Record<string, unknown> = {
      greet(args: Record<string, unknown>) {
        return `Hello, ${args.name}!`
      },
    }
    const result = await callFunction(mod, 'greet', {name: 'World'})
    expect(result).toBe('Hello, World!')
  })

  it('함수가 없으면 에러를 던진다', async () => {
    const mod: Record<string, unknown> = {
      foo() {
        return 1
      },
    }
    await expect(callFunction(mod, 'bar', {})).rejects.toThrow(
      'Function "bar" not found in module',
    )
  })

  it('에러 메시지에 사용 가능한 함수 목록을 표시한다', async () => {
    const mod: Record<string, unknown> = {
      alpha() {
        return 1
      },
      beta() {
        return 2
      },
      notAFunction: 'string-value',
    }
    await expect(callFunction(mod, 'missing', {})).rejects.toThrow('Available: alpha, beta')
  })
})

// ── JSProvider.execute ──

describe('JSProvider.execute', () => {
  function makeJsSpec(overrides: Partial<CommandSpec> = {}): CommandSpec {
    return {
      id: 'test:greet',
      namespace: 'test',
      description: 'Test greeting',
      args: [],
      flags: [],
      examples: [],
      providerType: 'js',
      providerConfig: {
        type: 'js' as const,
        module: 'inline',
        function: 'greet',
      } satisfies JsCommandConfig,
      ...overrides,
    }
  }

  function makeInput(overrides: Partial<ExecutionInput> = {}): ExecutionInput {
    return {
      args: {},
      flags: {},
      raw: [],
      ...overrides,
    }
  }

  it('함수를 호출하고 결과를 반환한다', async () => {
    const provider = new JSProvider({module: 'dummy'})

    // Pre-populate module cache to avoid actual file loading
    const mod: Record<string, unknown> = {
      greet(args: Record<string, unknown>) {
        return `Hi, ${args.name}!`
      },
    }
    // Access private cache via type assertion
    ;(provider as unknown as {moduleCache: Map<string, Record<string, unknown>>}).moduleCache.set(
      'inline',
      mod,
    )

    const spec = makeJsSpec()
    const input = makeInput({args: {name: 'Alice'}})

    const result = await provider.execute(spec, input)
    expect(result.success).toBe(true)
    expect(result.data).toBe('Hi, Alice!')
    expect(result.exitCode).toBe(0)
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('함수가 에러를 던지면 실패 결과를 반환한다', async () => {
    const provider = new JSProvider({module: 'dummy'})

    const mod: Record<string, unknown> = {
      fail() {
        throw new Error('Something went wrong')
      },
    }
    ;(provider as unknown as {moduleCache: Map<string, Record<string, unknown>>}).moduleCache.set(
      'inline',
      mod,
    )

    const spec = makeJsSpec({
      providerConfig: {
        type: 'js' as const,
        module: 'inline',
        function: 'fail',
      } satisfies JsCommandConfig,
    })
    const input = makeInput()

    const result = await provider.execute(spec, input)
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.error?.code).toBe('JS_ERROR')
    expect(result.error?.message).toBe('Something went wrong')
  })
})
