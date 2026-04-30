import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {buildCliArgs, sanitizeArg, CLIProvider} from '../src/providers/cli/provider.js'
import {spawnProcess} from '../src/providers/cli/process.js'
import * as processModule from '../src/providers/cli/process.js'
import {parseOutput} from '../src/providers/cli/output-parser.js'
import type {CommandSpec, ExecutionInput} from '../src/core/types.js'

function makeSpec(overrides: Partial<CommandSpec> = {}): CommandSpec {
  return {
    id: 'k8s:pods:list',
    namespace: 'k8s',
    description: 'Pod 목록 조회',
    args: [],
    flags: [],
    examples: [],
    providerType: 'cli',
    providerConfig: {
      type: 'cli' as const,
      cliTemplate: 'get pods',
      outputParser: 'json' as const,
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

describe('buildCliArgs', () => {
  it('cliTemplate에서 arg를 치환한다', () => {
    const spec = makeSpec({
      providerConfig: {
        type: 'cli',
        cliTemplate: 'get pods {name}',
        outputParser: 'json',
      },
      args: [{name: 'name', required: true}],
    })
    const input = makeInput({args: {name: 'nginx'}})

    const result = buildCliArgs(spec, input)
    expect(result).toEqual(['get', 'pods', 'nginx'])
  })

  it('cliMap으로 flag를 매핑한다 (non-boolean)', () => {
    const spec = makeSpec({
      flags: [{name: 'namespace', char: 'n', cliMap: '-n {value}'}],
    })
    const input = makeInput({flags: {namespace: 'default'}})

    const result = buildCliArgs(spec, input)
    expect(result).toEqual(['get', 'pods', '-n', 'default'])
  })

  it('boolean cliMap을 처리한다', () => {
    const spec = makeSpec({
      flags: [{name: 'all-namespaces', type: 'boolean', cliMap: '--all-namespaces'}],
    })
    const input = makeInput({flags: {'all-namespaces': true}})

    const result = buildCliArgs(spec, input)
    expect(result).toEqual(['get', 'pods', '--all-namespaces'])
  })

  it('boolean flag가 false이면 추가하지 않는다', () => {
    const spec = makeSpec({
      flags: [{name: 'all-namespaces', type: 'boolean', cliMap: '--all-namespaces'}],
    })
    const input = makeInput({flags: {'all-namespaces': false}})

    const result = buildCliArgs(spec, input)
    expect(result).toEqual(['get', 'pods'])
  })

  it('globalFlags를 추가한다', () => {
    const spec = makeSpec()
    const input = makeInput()

    const result = buildCliArgs(spec, input, ['-o', 'json'])
    expect(result).toEqual(['get', 'pods', '-o', 'json'])
  })

  it('overrideGlobalFlags가 설정되면 globalFlags를 추가하지 않는다', () => {
    const spec = makeSpec({
      providerConfig: {
        type: 'cli',
        cliTemplate: 'get pods',
        outputParser: 'json',
        overrideGlobalFlags: ['-o', 'yaml'],
      },
    })
    const input = makeInput()

    const result = buildCliArgs(spec, input, ['-o', 'json'])
    expect(result).toEqual(['get', 'pods'])
  })

  it('여러 flag와 arg를 함께 처리한다', () => {
    const spec = makeSpec({
      providerConfig: {
        type: 'cli',
        cliTemplate: 'logs {name}',
        outputParser: 'lines',
      },
      args: [{name: 'name', required: true}],
      flags: [
        {name: 'namespace', char: 'n', cliMap: '-n {value}'},
        {name: 'follow', type: 'boolean', cliMap: '-f'},
      ],
    })
    const input = makeInput({
      args: {name: 'nginx-pod'},
      flags: {namespace: 'production', follow: true},
    })

    const result = buildCliArgs(spec, input, ['-o', 'json'])
    expect(result).toEqual(['logs', 'nginx-pod', '-n', 'production', '-f', '-o', 'json'])
  })

  // ── Security: shell metacharacter handling ──

  it('arg 값에 쉘 메타문자(;, |, &, $(...))가 포함되어도 단일 인자로 유지된다', () => {
    const spec = makeSpec({
      providerConfig: {
        type: 'cli',
        cliTemplate: 'get pods {name}',
        outputParser: 'json',
      },
      args: [{name: 'name', required: true}],
    })

    const maliciousInputs = [
      'foo; rm -rf /',
      'foo | cat /etc/passwd',
      'foo & whoami',
      '$(whoami)',
      'foo`whoami`bar',
    ]

    for (const malicious of maliciousInputs) {
      const input = makeInput({args: {name: malicious}})
      const result = buildCliArgs(spec, input)
      // The malicious value should be ONE argument, not split on spaces/metacharacters
      expect(result).toHaveLength(3)
      expect(result[0]).toBe('get')
      expect(result[1]).toBe('pods')
      // The third element must contain the full malicious string intact
      expect(result[2]).toBe(malicious)
    }
  })

  it('arg 값에 공백이 포함되어도 단일 인자로 유지된다', () => {
    const spec = makeSpec({
      providerConfig: {
        type: 'cli',
        cliTemplate: 'get pods {name}',
        outputParser: 'json',
      },
      args: [{name: 'name', required: true}],
    })
    const input = makeInput({args: {name: 'my pod name'}})

    const result = buildCliArgs(spec, input)
    expect(result).toEqual(['get', 'pods', 'my pod name'])
  })

  it('cliMap flag 값에 특수문자가 포함되어도 단일 인자로 유지된다', () => {
    const spec = makeSpec({
      flags: [{name: 'label', cliMap: '-l {value}'}],
    })
    const input = makeInput({flags: {label: 'app=nginx; rm -rf /'}})

    const result = buildCliArgs(spec, input)
    expect(result).toEqual(['get', 'pods', '-l', 'app=nginx; rm -rf /'])
  })

  it('cliMap flag 값에 공백이 포함되어도 값 부분이 단일 인자로 유지된다', () => {
    const spec = makeSpec({
      flags: [{name: 'namespace', char: 'n', cliMap: '-n {value}'}],
    })
    const input = makeInput({flags: {namespace: 'my namespace'}})

    const result = buildCliArgs(spec, input)
    expect(result).toEqual(['get', 'pods', '-n', 'my namespace'])
  })
})

describe('sanitizeArg', () => {
  it('null 바이트를 제거한다', () => {
    expect(sanitizeArg('hello\0world')).toBe('helloworld')
  })

  it('일반 문자열은 변경하지 않는다', () => {
    expect(sanitizeArg('normal-value')).toBe('normal-value')
  })

  it('쉘 메타문자는 유지한다 (spawn args array에서는 안전)', () => {
    expect(sanitizeArg('foo; bar | baz & $(cmd)')).toBe('foo; bar | baz & $(cmd)')
  })
})

describe('parseOutput', () => {
  it('json 파서: JSON 문자열을 객체로 파싱한다', () => {
    const result = parseOutput('{"name":"nginx","status":"running"}', 'json')
    expect(result).toEqual({name: 'nginx', status: 'running'})
  })

  it('line 파서: 양쪽 공백을 제거하고 단일 문자열을 반환한다', () => {
    const result = parseOutput('  hello world  \n', 'line')
    expect(result).toBe('hello world')
  })

  it('lines 파서: 줄 단위로 분리하고 빈 줄을 제거한다', () => {
    const result = parseOutput('line1\nline2\n\nline3\n', 'lines')
    expect(result).toEqual(['line1', 'line2', 'line3'])
  })

  it('table 파서: 공백 구분 테이블을 객체 배열로 파싱한다', () => {
    const stdout = 'NAME  STATUS  AGE\nnginx  Running  5d\nredis  Pending  1d\n'
    const result = parseOutput(stdout, 'table') as Record<string, string>[]
    expect(result).toEqual([
      {NAME: 'nginx', STATUS: 'Running', AGE: '5d'},
      {NAME: 'redis', STATUS: 'Pending', AGE: '1d'},
    ])
  })

  it('csv 파서: CSV를 객체 배열로 파싱한다', () => {
    const stdout = 'name,status\nnginx,running\nredis,stopped\n'
    const result = parseOutput(stdout, 'csv') as Record<string, string>[]
    expect(result).toEqual([
      {name: 'nginx', status: 'running'},
      {name: 'redis', status: 'stopped'},
    ])
  })

  it('yaml 파서: YAML 문자열을 객체로 파싱한다', () => {
    const stdout = 'name: nginx\nstatus: running\n'
    const result = parseOutput(stdout, 'yaml')
    expect(result).toEqual({name: 'nginx', status: 'running'})
  })

})

// ── spawnProcess error handling ──

describe('spawnProcess error handling', () => {
  it('존재하지 않는 바이너리에 대해 명확한 에러 메시지를 표시한다 (ENOENT)', async () => {
    await expect(
      spawnProcess({binary: 'nonexistent-binary-xyz-123', args: []}),
    ).rejects.toThrow('Command not found: "nonexistent-binary-xyz-123". Ensure it is installed and in your PATH.')
  })

  it('권한 거부 시 명확한 에러 메시지를 표시한다 (EACCES)', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-test-'))
    const noExecFile = path.join(tmpDir, 'no-exec')
    await fs.writeFile(noExecFile, '#!/bin/sh\necho hello')
    await fs.chmod(noExecFile, 0o644)

    try {
      await expect(
        spawnProcess({binary: noExecFile, args: []}),
      ).rejects.toThrow(`Permission denied: "${noExecFile}". Check file permissions.`)
    } finally {
      await fs.rm(tmpDir, {recursive: true, force: true})
    }
  })
})

// ── CLIProvider error/stderr capture ──

describe('CLIProvider.execute — stderr/stdout/exitCode/signal capture', () => {
  type SpawnResult = {stdout: string; stderr: string; exitCode: number; signal?: string | null}
  let spawnSpy: ReturnType<typeof vi.spyOn>

  function mockSpawnResolve(result: SpawnResult): void {
    spawnSpy.mockImplementation(async () => result as Awaited<ReturnType<typeof spawnProcess>>)
  }

  function mockSpawnReject(err: Error): void {
    spawnSpy.mockImplementation(async () => {
      throw err
    })
  }

  beforeEach(() => {
    spawnSpy = vi.spyOn(processModule, 'spawnProcess')
  })

  afterEach(() => {
    spawnSpy.mockRestore()
  })

  function makeProvider(): CLIProvider {
    return new CLIProvider({binary: 'kubectl'}, 'k8s')
  }

  // Case A: exit !== 0 + stderr "command not found"
  // → error.message contains stderr; details has stderr/stdout/exitCode.
  it('case A: exit !== 0 + stderr "command not found" → message=stderr, details 전부 보존', async () => {
    mockSpawnResolve({stdout: '', stderr: 'kubectl: command not found\n', exitCode: 127})

    const result = await makeProvider().execute(makeSpec(), makeInput())

    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(127)
    expect(result.error?.code).toBe('CLI_ERROR')
    expect(result.error?.message).toBe('kubectl: command not found')
    expect(result.error?.details).toMatchObject({
      stderr: 'kubectl: command not found\n',
      stdout: '',
      exitCode: 127,
    })
    // signal should not be present when not provided by the spawn result.
    expect((result.error?.details as Record<string, unknown>).signal).toBeUndefined()
  })

  // Case B: exit !== 0 + stderr 비어있고 stdout "warning..."
  // → error.message uses stdout; details still preserves both.
  it('case B: exit !== 0 + stderr 비어있고 stdout "warning..." → message=stdout', async () => {
    mockSpawnResolve({stdout: 'warning: cluster unreachable\n', stderr: '', exitCode: 2})

    const result = await makeProvider().execute(makeSpec(), makeInput())

    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(result.error?.message).toBe('warning: cluster unreachable')
    expect(result.error?.details).toMatchObject({
      stderr: '',
      stdout: 'warning: cluster unreachable\n',
      exitCode: 2,
    })
  })

  // Case C: 둘 다 비어있고 exit code 만 → error.message = "exit code N"
  it('case C: stderr/stdout 둘 다 비어있고 exit code 만 있음 → message="exit code N"', async () => {
    mockSpawnResolve({stdout: '', stderr: '', exitCode: 5})

    const result = await makeProvider().execute(makeSpec(), makeInput())

    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(5)
    expect(result.error?.message).toBe('exit code 5')
    expect(result.error?.details).toMatchObject({stderr: '', stdout: '', exitCode: 5})
  })

  // Case D: exit === 0 + stderr "Note: ..." → success=true, but details/notice 보존
  it('case D: exit === 0 + stderr "Note: ..." → success=true, stderr 디버그 정보 부착', async () => {
    mockSpawnResolve({stdout: '{"ok":true}', stderr: 'Note: deprecated flag used\n', exitCode: 0})

    const result = await makeProvider().execute(makeSpec(), makeInput())

    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.data).toEqual({ok: true})
    // success path 에서도 stderr 가 비어있지 않으면 details/error notice 로 보존
    expect(result.error).toBeDefined()
    expect(result.error?.code).toBe('CLI_STDERR_NOTICE')
    expect(result.error?.message).toBe('Note: deprecated flag used')
    expect(result.error?.details).toMatchObject({
      stderr: 'Note: deprecated flag used\n',
      stdout: '{"ok":true}',
      exitCode: 0,
    })
  })

  it('case D-alt: exit === 0 + stderr 비어있음 → error 필드 없음 (clean success)', async () => {
    mockSpawnResolve({stdout: '{"ok":true}', stderr: '', exitCode: 0})

    const result = await makeProvider().execute(makeSpec(), makeInput())

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  // Case E: signal 로 종료 (SIGTERM/SIGKILL) → details.signal 포함
  // process.ts 가 timeout 시 reject 하면서 "timed out ... killed" 메시지를 던진다.
  // CLIProvider 는 catch 분기에서 signal 을 details.signal 로 surface.
  it('case E: spawn 이 timeout-kill 로 reject → details.signal 보존', async () => {
    mockSpawnReject(new Error('Process "kubectl" timed out after 30000ms and was killed.'))

    const result = await makeProvider().execute(makeSpec(), makeInput())

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('CLI_EXECUTION_ERROR')
    expect(result.error?.message).toMatch(/timed out .* killed/)
    expect(result.error?.details).toMatchObject({signal: 'SIGKILL'})
  })

  it('case E-alt: spawnProcess 가 직접 signal 필드를 surface 하면 그 값을 details.signal 로 전달', async () => {
    // Forward-compatibility: if process.ts ever exposes a `signal` field on
    // ProcessResult, the provider should pass it through without re-mapping.
    mockSpawnResolve({stdout: '', stderr: 'killed', exitCode: 1, signal: 'SIGTERM'})

    const result = await makeProvider().execute(makeSpec(), makeInput())

    expect(result.success).toBe(false)
    expect(result.error?.details).toMatchObject({
      stderr: 'killed',
      stdout: '',
      exitCode: 1,
      signal: 'SIGTERM',
    })
  })

  it('error.details 는 항상 stderr/stdout/exitCode 키를 포함한다 (스키마 안정성)', async () => {
    mockSpawnResolve({stdout: 'out', stderr: 'err', exitCode: 9})

    const result = await makeProvider().execute(makeSpec(), makeInput())

    const details = result.error?.details as Record<string, unknown>
    expect(details).toBeDefined()
    expect(Object.keys(details)).toEqual(expect.arrayContaining(['stderr', 'stdout', 'exitCode']))
    expect(details.stderr).toBe('err')
    expect(details.stdout).toBe('out')
    expect(details.exitCode).toBe(9)
  })
})
