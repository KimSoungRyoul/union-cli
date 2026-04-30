import {describe, it, expect, vi, beforeEach} from 'vitest'
import {Executor} from '../src/core/executor.js'
import type {
  IProvider,
  CommandSpec,
  ExecutionInput,
  ExecutionResult,
  PluginManifest,
} from '../src/core/types.js'

// ── Helper factories ──

function makeProvider(overrides: Partial<IProvider> = {}): IProvider {
  return {
    type: 'http',
    resolveCommands: vi.fn(() => []),
    execute: vi.fn(async () => ({
      success: true,
      data: {id: 1},
      exitCode: 0,
      duration: 0,
    })),
    ...overrides,
  }
}

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: 'test-plugin',
    namespace: 'test',
    description: 'A test plugin',
    provider: {
      type: 'http',
      config: {baseUrl: 'http://localhost:3000'},
    },
    commands: [
      {
        id: 'items:list',
        description: 'List items',
        http: {method: 'GET', path: '/items'},
      },
    ],
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

// ── Tests ──

describe('Executor', () => {
  let executor: Executor

  beforeEach(() => {
    executor = new Executor()
  })

  // ── registerProvider ──

  describe('registerProvider', () => {
    it('네임스페이스에 대해 프로바이더를 등록한다', () => {
      const provider = makeProvider()
      executor.registerProvider('test', provider)

      expect(executor.getProvider('test')).toBe(provider)
    })

    it('같은 네임스페이스에 새 프로바이더를 등록하면 덮어쓴다', () => {
      const provider1 = makeProvider()
      const provider2 = makeProvider({type: 'cli'})
      executor.registerProvider('test', provider1)
      executor.registerProvider('test', provider2)

      expect(executor.getProvider('test')).toBe(provider2)
    })

    it('등록되지 않은 네임스페이스는 undefined를 반환한다', () => {
      expect(executor.getProvider('nonexistent')).toBeUndefined()
    })
  })

  // ── registerManifest ──

  describe('registerManifest', () => {
    it('매니페스트를 레지스트리에 등록한다', () => {
      const manifest = makeManifest()
      executor.registerManifest(manifest)

      const spec = executor.registry.get('test:items:list')
      expect(spec).toBeDefined()
      expect(spec!.id).toBe('test:items:list')
      expect(spec!.namespace).toBe('test')
    })

    it('여러 매니페스트를 등록할 수 있다', () => {
      const manifest1 = makeManifest()
      const manifest2 = makeManifest({
        name: 'another-plugin',
        namespace: 'another',
        commands: [
          {
            id: 'things:get',
            description: 'Get things',
            http: {method: 'GET', path: '/things'},
          },
        ],
      })

      executor.registerManifest(manifest1)
      executor.registerManifest(manifest2)

      expect(executor.registry.get('test:items:list')).toBeDefined()
      expect(executor.registry.get('another:things:get')).toBeDefined()
    })
  })

  // ── execute ──

  describe('execute', () => {
    it('유효한 spec일 때 provider.execute()를 호출하고 결과를 반환한다', async () => {
      const provider = makeProvider({
        execute: vi.fn(async () => ({
          success: true,
          data: {items: [1, 2, 3]},
          exitCode: 0,
          duration: 0,
        })),
      })

      executor.registerManifest(makeManifest())
      executor.registerProvider('test', provider)

      const result = await executor.execute('test:items:list', makeInput())

      expect(result.success).toBe(true)
      expect(result.data).toEqual({items: [1, 2, 3]})
      expect(result.exitCode).toBe(0)
      expect(provider.execute).toHaveBeenCalledOnce()
    })

    it('알 수 없는 spec ID일 때 에러 결과를 반환한다', async () => {
      executor.registerManifest(makeManifest())
      executor.registerProvider('test', makeProvider())

      const result = await executor.execute('test:nonexistent:cmd', makeInput())

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(2)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('COMMAND_NOT_FOUND')
      expect(result.error!.message).toContain('test:nonexistent:cmd')
    })

    it('등록되지 않은 프로바이더 네임스페이스일 때 에러 결과를 반환한다', async () => {
      executor.registerManifest(makeManifest())
      // Provider를 등록하지 않음

      const result = await executor.execute('test:items:list', makeInput())

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('PROVIDER_NOT_FOUND')
      expect(result.error!.message).toContain('test')
    })

    it('provider.execute()가 에러를 던지면 에러 결과를 반환한다', async () => {
      const provider = makeProvider({
        execute: vi.fn(async () => {
          throw new Error('Network connection failed')
        }),
      })

      executor.registerManifest(makeManifest())
      executor.registerProvider('test', provider)

      const result = await executor.execute('test:items:list', makeInput())

      expect(result.success).toBe(false)
      expect(result.exitCode).toBe(1)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('EXECUTION_ERROR')
      expect(result.error!.message).toBe('Network connection failed')
      expect(result.error!.details).toBeDefined() // stack trace
    })

    it('provider.execute()가 비-Error 객체를 던져도 에러 결과를 반환한다', async () => {
      const provider = makeProvider({
        execute: vi.fn(async () => {
          throw 'string error'  // eslint-disable-line no-throw-literal
        }),
      })

      executor.registerManifest(makeManifest())
      executor.registerProvider('test', provider)

      const result = await executor.execute('test:items:list', makeInput())

      expect(result.success).toBe(false)
      expect(result.error!.code).toBe('EXECUTION_ERROR')
      expect(result.error!.message).toBe('string error')
      expect(result.error!.details).toBeUndefined()
    })

    it('실행 시간(duration)이 0보다 크다', async () => {
      const provider = makeProvider({
        execute: vi.fn(async () => {
          // 약간의 지연 시뮬레이션
          await new Promise(resolve => setTimeout(resolve, 5))
          return {
            success: true,
            data: null,
            exitCode: 0,
            duration: 0,
          }
        }),
      })

      executor.registerManifest(makeManifest())
      executor.registerProvider('test', provider)

      const result = await executor.execute('test:items:list', makeInput())

      expect(result.duration).toBeGreaterThan(0)
    })

    it('에러 결과에서도 duration이 0보다 크다', async () => {
      // Unknown spec ID → immediate error, but still measures duration
      const result = await executor.execute('nonexistent:cmd', makeInput())

      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(typeof result.duration).toBe('number')
    })

    it('provider.execute()에 올바른 spec과 input을 전달한다', async () => {
      const executeFn = vi.fn(async () => ({
        success: true,
        data: null,
        exitCode: 0,
        duration: 0,
      }))
      const provider = makeProvider({execute: executeFn})

      executor.registerManifest(makeManifest())
      executor.registerProvider('test', provider)

      const input = makeInput({
        args: {id: '42'},
        flags: {verbose: true},
        raw: ['items', 'list', '--verbose'],
      })

      await executor.execute('test:items:list', input)

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test:items:list',
          namespace: 'test',
        }),
        input,
      )
    })
  })
})
