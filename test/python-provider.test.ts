import {describe, it, expect} from 'vitest'
import {buildKwargs} from '../src/providers/python/provider.js'
import {PythonBridge} from '../src/providers/python/bridge.js'
import {introspectModule} from '../src/providers/python/introspect.js'
import type {CommandSpec, ExecutionInput} from '../src/core/types.js'

function makePySpec(overrides: Partial<CommandSpec> = {}): CommandSpec {
  return {
    id: 'feature-store:entity:get',
    namespace: 'feature-store',
    description: 'Get entity features',
    args: [],
    flags: [],
    examples: [],
    providerType: 'python',
    providerConfig: {
      type: 'python' as const,
      module: 'feature_store',
      function: 'get_entity',
    },
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

// ── buildKwargs ──

describe('buildKwargs', () => {
  it('pythonName이 정의된 flag를 해당 이름으로 매핑한다', () => {
    const spec = makePySpec({
      flags: [
        {name: 'entity-id', pythonName: 'entity_id'},
      ],
    })
    const input = makeInput({flags: {'entity-id': 'user-123'}})

    const result = buildKwargs(spec, input)
    expect(result).toEqual({entity_id: 'user-123'})
  })

  it('pythonName이 없는 flag는 이름에서 하이픈을 언더스코어로 변환한다', () => {
    const spec = makePySpec({
      flags: [
        {name: 'max-results'},
        {name: 'include-deleted', type: 'boolean'},
      ],
    })
    const input = makeInput({
      flags: {'max-results': 50, 'include-deleted': true},
    })

    const result = buildKwargs(spec, input)
    expect(result).toEqual({max_results: 50, include_deleted: true})
  })

  it('args를 그대로 전달한다', () => {
    const spec = makePySpec({
      args: [{name: 'name', required: true}],
    })
    const input = makeInput({args: {name: 'my-entity'}})

    const result = buildKwargs(spec, input)
    expect(result).toEqual({name: 'my-entity'})
  })

  it('args와 flags를 함께 처리한다', () => {
    const spec = makePySpec({
      args: [{name: 'name', required: true}],
      flags: [
        {name: 'entity-id', pythonName: 'entity_id'},
        {name: 'max-results'},
      ],
    })
    const input = makeInput({
      args: {name: 'user-features'},
      flags: {'entity-id': 'u-42', 'max-results': 10},
    })

    const result = buildKwargs(spec, input)
    expect(result).toEqual({
      name: 'user-features',
      entity_id: 'u-42',
      max_results: 10,
    })
  })

  it('값이 undefined인 flag는 무시한다', () => {
    const spec = makePySpec({
      flags: [
        {name: 'entity-id', pythonName: 'entity_id'},
        {name: 'max-results'},
      ],
    })
    const input = makeInput({flags: {'entity-id': 'u-42'}})

    const result = buildKwargs(spec, input)
    expect(result).toEqual({entity_id: 'u-42'})
    expect(result).not.toHaveProperty('max_results')
  })

  it('하이픈이 없는 flag 이름은 그대로 사용한다', () => {
    const spec = makePySpec({
      flags: [{name: 'limit'}],
    })
    const input = makeInput({flags: {limit: 100}})

    const result = buildKwargs(spec, input)
    expect(result).toEqual({limit: 100})
  })

  it('flag와 arg에 같은 이름이 있으면 flag가 덮어쓴다', () => {
    const spec = makePySpec({
      args: [{name: 'name'}],
      flags: [{name: 'name', pythonName: 'name'}],
    })
    const input = makeInput({
      args: {name: 'from-arg'},
      flags: {name: 'from-flag'},
    })

    const result = buildKwargs(spec, input)
    expect(result).toEqual({name: 'from-flag'})
  })
})

// ── PythonBridge constructor ──

describe('PythonBridge constructor', () => {
  it('기본값을 올바르게 설정한다', () => {
    const bridge = new PythonBridge({module: 'my_module'})
    // Access private options via type assertion for testing
    const opts = (bridge as unknown as {options: Record<string, unknown>}).options
    expect(opts.pythonPath).toBe('python3')
    expect(opts.module).toBe('my_module')
    expect(opts.persistent).toBe(false)
    expect(opts.idleTimeout).toBe(300_000)
    expect(opts.venv).toBe('')
  })

  it('사용자 옵션으로 기본값을 덮어쓴다', () => {
    const bridge = new PythonBridge({
      pythonPath: '/usr/local/bin/python3.11',
      module: 'feature_store',
      persistent: true,
      idleTimeout: 60_000,
      venv: '/home/user/.venvs/ml',
    })
    const opts = (bridge as unknown as {options: Record<string, unknown>}).options
    expect(opts.pythonPath).toBe('/usr/local/bin/python3.11')
    expect(opts.module).toBe('feature_store')
    expect(opts.persistent).toBe(true)
    expect(opts.idleTimeout).toBe(60_000)
    expect(opts.venv).toBe('/home/user/.venvs/ml')
  })
})

// ── introspectModule stub ──

describe('introspectModule', () => {
  it('스텁이 null을 반환한다', async () => {
    const result = await introspectModule('any_module')
    expect(result).toBeNull()
  })
})

// ── bridge.py integration (optional, skip if python3 not available) ──

describe('bridge.py integration', () => {
  let pythonAvailable = false

  // Check for python3 before running integration tests
  const checkPython = async (): Promise<boolean> => {
    const {execSync} = await import('node:child_process')
    try {
      execSync('python3 --version', {stdio: 'pipe'})
      return true
    } catch {
      return false
    }
  }

  it('python3가 사용 가능한 경우 bridge를 통해 내장 모듈을 호출할 수 있다', async () => {
    pythonAvailable = await checkPython()
    if (!pythonAvailable) {
      return // skip
    }

    const {spawn} = await import('node:child_process')
    const {resolve} = await import('node:path')

    const bridgePath = resolve(
      import.meta.dirname ?? new URL('.', import.meta.url).pathname,
      '..', 'bridge', 'union_cli_bridge.py',
    )

    const proc = spawn('python3', [bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const request = JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        function: 'dumps',
        kwargs: {obj: {hello: 'world'}},
        module: 'json',
      },
      id: 1,
    })

    const result = await new Promise<string>((resolvePromise, reject) => {
      let output = ''
      proc.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        if (output.includes('\n')) {
          resolvePromise(output.trim())
        }
      })
      proc.stderr?.on('data', (chunk: Buffer) => {
        reject(new Error(`stderr: ${chunk.toString()}`))
      })
      proc.on('error', reject)
      proc.stdin?.write(request + '\n')

      // Timeout after 5 seconds
      setTimeout(() => reject(new Error('Timed out waiting for bridge response')), 5000)
    })

    proc.kill()

    const parsed = JSON.parse(result)
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.id).toBe(1)
    // json.dumps({hello: 'world'}) returns '{"hello": "world"}'
    expect(JSON.parse(parsed.result)).toEqual({hello: 'world'})
  })
})
