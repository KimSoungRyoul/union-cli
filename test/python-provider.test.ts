import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {execSync} from 'node:child_process'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
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
    expect(opts.callTimeoutMs).toBe(60_000)
    expect(opts.shutdownGraceMs).toBe(3_000)
  })

  it('사용자 옵션으로 기본값을 덮어쓴다', () => {
    const bridge = new PythonBridge({
      pythonPath: '/usr/local/bin/python3.11',
      module: 'feature_store',
      persistent: true,
      idleTimeout: 60_000,
      venv: '/home/user/.venvs/ml',
      callTimeoutMs: 5_000,
      shutdownGraceMs: 500,
    })
    const opts = (bridge as unknown as {options: Record<string, unknown>}).options
    expect(opts.pythonPath).toBe('/usr/local/bin/python3.11')
    expect(opts.module).toBe('feature_store')
    expect(opts.persistent).toBe(true)
    expect(opts.idleTimeout).toBe(60_000)
    expect(opts.venv).toBe('/home/user/.venvs/ml')
    expect(opts.callTimeoutMs).toBe(5_000)
    expect(opts.shutdownGraceMs).toBe(500)
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

// ── PythonBridge stderr-handling regression suite ──
//
// These tests exercise PythonBridge end-to-end against a real python3
// interpreter, using a temporary helper module placed on PYTHONPATH.
// They cover:
//   case 1 — Python warning on stderr while stdout response succeeds
//   case 2 — Python function raises an exception
//   case 3 — Python interpreter exits abnormally before responding
//   case 4 — Python function never responds within callTimeoutMs
//   case 5 — graceful shutdown of a persistent bridge process

const pythonAvailable = (() => {
  try {
    execSync('python3 --version', {stdio: 'pipe'})
    return true
  } catch {
    return false
  }
})()

describe.runIf(pythonAvailable)('PythonBridge stderr handling', () => {
  let tmpDir: string
  let originalPythonPath: string | undefined

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'union-cli-bridge-test-'))

    // Helper module installed on PYTHONPATH. Each function exercises a
    // different stderr-handling scenario.
    const helper = `
import sys
import time

def noisy(value):
    """case 1 — emits stderr (DeprecationWarning-style) but returns success."""
    sys.stderr.write('test deprecation warning\\n')
    sys.stderr.flush()
    return {'ok': True, 'echo': value}

def boom():
    """case 2 — raises an exception, bridge must surface it as success=False."""
    raise ValueError('intentional failure')

def kaboom():
    """case 3 — kills the interpreter before responding."""
    sys.stderr.write('fatal: bridge dying\\n')
    sys.stderr.flush()
    sys.exit(1)

def slow():
    """case 4 — never responds within reasonable time."""
    time.sleep(10)
    return 'too late'
`
    writeFileSync(join(tmpDir, 'union_test_helper.py'), helper, 'utf8')

    originalPythonPath = process.env['PYTHONPATH']
    process.env['PYTHONPATH'] = originalPythonPath
      ? `${tmpDir}:${originalPythonPath}`
      : tmpDir
  })

  afterAll(() => {
    if (originalPythonPath === undefined) {
      delete process.env['PYTHONPATH']
    } else {
      process.env['PYTHONPATH'] = originalPythonPath
    }
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('case 1 — stderr 경고가 있어도 정상 응답이면 success가 된다', async () => {
    const bridge = new PythonBridge({module: 'union_test_helper'})
    try {
      const result = await bridge.call('noisy', {value: 42})
      expect(result.success).toBe(true)
      expect(result.data).toEqual({ok: true, echo: 42})
      // stderrLog is captured, but the call still succeeded.
      expect(result.stderrLog).toMatch(/test deprecation warning/)
    } finally {
      await bridge.shutdown()
    }
  })

  it('case 2 — Python 함수가 예외를 던지면 success=false + error 메시지를 반환한다', async () => {
    const bridge = new PythonBridge({module: 'union_test_helper'})
    try {
      const result = await bridge.call('boom', {})
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/intentional failure/)
    } finally {
      await bridge.shutdown()
    }
  })

  it('case 3 — Python 프로세스가 비정상 종료하면 reject + stderr 가 사유에 포함된다', async () => {
    const bridge = new PythonBridge({
      module: 'union_test_helper',
      callTimeoutMs: 5_000,
    })
    try {
      await expect(bridge.call('kaboom', {})).rejects.toThrow(/fatal: bridge dying/)
    } finally {
      await bridge.shutdown()
    }
  })

  it('case 4 — 응답이 callTimeoutMs 안에 안 오면 timeout 으로 reject 한다', async () => {
    const bridge = new PythonBridge({
      module: 'union_test_helper',
      callTimeoutMs: 200,
      persistent: true,
    })
    try {
      await expect(bridge.call('slow', {})).rejects.toThrow(/timed out after 200ms/)
    } finally {
      await bridge.shutdown()
    }
  })

  it('case 5 — persistent 모드에서 shutdown() 하면 SIGTERM 으로 graceful 종료한다', async () => {
    const bridge = new PythonBridge({
      module: 'union_test_helper',
      persistent: true,
      shutdownGraceMs: 2_000,
    })

    // First call to spawn the process and confirm it is alive.
    const result = await bridge.call('noisy', {value: 'alive'})
    expect(result.success).toBe(true)

    const proc = (bridge as unknown as {process: unknown}).process
    expect(proc).not.toBeNull()

    const start = Date.now()
    await bridge.shutdown()
    const elapsed = Date.now() - start

    // Should exit within the grace window (well under shutdownGraceMs).
    expect(elapsed).toBeLessThan(2_000)
    // Process reference is cleared after shutdown.
    const procAfter = (bridge as unknown as {process: unknown}).process
    expect(procAfter).toBeNull()
  })
})
