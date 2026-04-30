import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import hook, {
  levenshtein,
  collectCandidates,
  rankSuggestions,
} from '../src/hooks/command-not-found.js'
import type {PluginManifest} from '../src/core/types.js'

// ── Fixtures ──

function makeConfig(overrides: {
  commandIDs?: string[]
  commands?: Array<{id: string; aliases?: string[]; hidden?: boolean}>
  topicSeparator?: ':' | ' '
  bin?: string
} = {}): unknown {
  return {
    bin: overrides.bin ?? 'union-cli',
    topicSeparator: overrides.topicSeparator ?? ' ',
    commandIDs: overrides.commandIDs ?? [],
    commands: (overrides.commands ?? []).map((c) => ({
      id: c.id,
      aliases: c.aliases ?? [],
      hidden: c.hidden ?? false,
    })),
  }
}

interface CapturedExit {
  code: number | undefined
}

function makeHookCtx(captured: CapturedExit) {
  return {
    debug: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((msg: unknown, _o?: unknown) => {
      throw new Error(typeof msg === 'string' ? msg : String(msg))
    }),
    exit: (code?: number) => {
      captured.code = code
      throw new ExitSignal(code ?? 0)
    },
    config: undefined as unknown,
  }
}

class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super(`__exit:${code}`)
  }
}

const STATIC_BUILTIN_IDS = [
  'doctor',
  'auth:login',
  'auth:logout',
  'auth:status',
  'auth:token',
  'config:get',
  'config:list',
  'config:reset',
  'config:set',
  'plugin:add',
  'plugin:list',
  'plugin:remove',
  'completion:install',
  'build',
  'codegen',
  'init',
]

function makeManifest(namespace: string, commandIds: string[] = []): PluginManifest {
  return {
    name: namespace,
    namespace,
    description: `${namespace} provider`,
    provider: {type: 'http', config: {baseUrl: 'http://localhost'}},
    commands: commandIds.map((id) => ({
      id,
      description: `${namespace}:${id}`,
      http: {method: 'GET', path: '/'},
    })),
  }
}

// ── stderr capture ──

let stderrSpy: ReturnType<typeof vi.spyOn>
let stderrChunks: string[]

beforeEach(() => {
  stderrChunks = []
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
    stderrChunks.push(typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf-8'))
    return true
  })
})

afterEach(() => {
  stderrSpy.mockRestore()
  delete (globalThis as Record<string, unknown>).__unionCliExecutor
})

function readStderr(): string {
  return stderrChunks.join('')
}

// ── Pure helpers ──

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('foo', 'foo')).toBe(0)
  })

  it('returns length for empty inputs', () => {
    expect(levenshtein('', 'abcd')).toBe(4)
    expect(levenshtein('abcd', '')).toBe(4)
  })

  it('counts a single substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1)
  })

  it('counts a single insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1)
  })

  it('counts a single deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1)
  })

  it('handles multi-edit transformations', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('apii', 'api')).toBe(1)
    expect(levenshtein('doctorr', 'doctor')).toBe(1)
  })
})

describe('collectCandidates', () => {
  it('combines commandIDs, aliases, and manifest namespaces', () => {
    const manifests: PluginManifest[] = [
      makeManifest('myapi', ['users:list', 'users:create']),
      makeManifest('lona', ['loadtest:run']),
    ]
    const ids = collectCandidates({
      commandIDs: ['doctor', 'auth:login'],
      commandAliases: ['login'],
      manifests,
    })
    expect(ids).toContain('doctor')
    expect(ids).toContain('auth:login')
    expect(ids).toContain('login')
    expect(ids).toContain('myapi')
    expect(ids).toContain('myapi:users:list')
    expect(ids).toContain('myapi:users:create')
    expect(ids).toContain('lona')
    expect(ids).toContain('lona:loadtest:run')
  })

  it('deduplicates entries', () => {
    const ids = collectCandidates({
      commandIDs: ['doctor', 'doctor'],
      commandAliases: ['doctor'],
    })
    const occurrences = ids.filter((id) => id === 'doctor').length
    expect(occurrences).toBe(1)
  })

  it('handles empty manifests gracefully', () => {
    const ids = collectCandidates({commandIDs: ['doctor']})
    expect(ids).toEqual(['doctor'])
  })
})

describe('rankSuggestions', () => {
  it('returns top suggestions sorted by distance', () => {
    const candidates = ['doctor', 'auth:login', 'config:list', 'plugin:add']
    const result = rankSuggestions('doctorr', candidates, 3, 3)
    expect(result[0].id).toBe('doctor')
    expect(result[0].distance).toBe(1)
  })

  it('respects the limit', () => {
    const result = rankSuggestions('aut', ['auth', 'cut', 'gut', 'put'], 2, 3)
    expect(result).toHaveLength(2)
  })

  it('drops suggestions beyond maxDistance', () => {
    const result = rankSuggestions('xyz', ['doctor', 'auth:login'], 3, 3)
    expect(result).toEqual([])
  })

  it('returns [] for empty target', () => {
    expect(rankSuggestions('', ['a', 'b'])).toEqual([])
  })

  it('orders ties alphabetically for stability', () => {
    const result = rankSuggestions('test', ['rest', 'best', 'fest'], 5, 3)
    expect(result.map((s) => s.id)).toEqual(['best', 'fest', 'rest'])
  })
})

// ── Hook integration ──

async function runHook(
  config: unknown,
  id: string,
  argv: string[] = [],
): Promise<{exitCode: number | undefined; stderr: string}> {
  const captured: CapturedExit = {code: undefined}
  const ctx = makeHookCtx(captured)
  ctx.config = config
  try {
    await (hook as unknown as (
      this: typeof ctx,
      o: {config: unknown; id: string; argv?: string[]; context: typeof ctx},
    ) => Promise<unknown>).call(ctx, {
      config: config as never,
      id,
      argv,
      context: ctx,
    })
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err
  }
  return {exitCode: captured.code, stderr: readStderr()}
}

describe('command_not_found hook', () => {
  it('case A: typo on namespace "apii" suggests "api"', async () => {
    ;(globalThis as Record<string, unknown>).__unionCliExecutor = {
      registry: {
        getAllManifests: () => [makeManifest('api', ['users:list'])],
      },
    }
    const config = makeConfig({commandIDs: STATIC_BUILTIN_IDS})
    const {exitCode, stderr} = await runHook(config, 'apii')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('not a union-cli command')
    expect(stderr).toContain('Did you mean')
    expect(stderr).toContain('union-cli api')
  })

  it('case B: typo "doctorr" suggests "doctor"', async () => {
    const config = makeConfig({commandIDs: STATIC_BUILTIN_IDS})
    const {exitCode, stderr} = await runHook(config, 'doctorr')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('union-cli doctor')
  })

  it('case C: completely unrelated input falls back to --help message', async () => {
    const config = makeConfig({commandIDs: STATIC_BUILTIN_IDS})
    const {exitCode, stderr} = await runHook(config, 'xyz')
    expect(exitCode).toBe(1)
    expect(stderr).not.toContain('Did you mean')
    expect(stderr).toContain("Run 'union-cli --help'")
  })

  it('case D: dynamic manifest namespace is recognized', async () => {
    ;(globalThis as Record<string, unknown>).__unionCliExecutor = {
      registry: {
        getAllManifests: () => [
          makeManifest('myapi', ['users:list', 'users:create']),
        ],
      },
    }
    const config = makeConfig({commandIDs: STATIC_BUILTIN_IDS})
    const {exitCode, stderr} = await runHook(config, 'myapy')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('Did you mean')
    expect(stderr).toContain('union-cli myapi')
  })

  it('renders multi-segment commands using topicSeparator', async () => {
    ;(globalThis as Record<string, unknown>).__unionCliExecutor = {
      registry: {
        getAllManifests: () => [makeManifest('api', ['users:list'])],
      },
    }
    const config = makeConfig({commandIDs: STATIC_BUILTIN_IDS, topicSeparator: ' '})
    const {stderr} = await runHook(config, 'api:users:lis')
    // separator must be space, not colon
    expect(stderr).toContain('union-cli api users list')
    expect(stderr).not.toContain('api:users:list')
  })

  it('does not auto-run any command (just suggests)', async () => {
    const runCommand = vi.fn()
    const config = {
      ...(makeConfig({commandIDs: STATIC_BUILTIN_IDS}) as Record<string, unknown>),
      runCommand,
    }
    const {exitCode} = await runHook(config, 'doctorr')
    expect(exitCode).toBe(1)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('skips hidden commands when scoring', async () => {
    const config = makeConfig({
      commandIDs: ['doctor'],
      commands: [{id: 'doctor', hidden: true}, {id: 'auth:login'}],
    })
    const {stderr} = await runHook(config, 'doctorr')
    // since 'doctor' is hidden, it should NOT be suggested
    expect(stderr).not.toContain('union-cli doctor\n')
  })

  it('caps suggestions at 3', async () => {
    const config = makeConfig({
      commandIDs: ['cat', 'bat', 'hat', 'mat', 'rat', 'pat'],
    })
    const {stderr} = await runHook(config, 'tat')
    // count non-empty bullet lines
    const bulletLines = stderr.split('\n').filter((l) => l.startsWith('  union-cli '))
    expect(bulletLines.length).toBeLessThanOrEqual(3)
  })
})
