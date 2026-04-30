import {describe, it, expect, vi, afterEach} from 'vitest'

// Mock node:fs at the module level so the bridge module picks it up
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (String(path).includes('union_cli_bridge.py')) {
        return false
      }
      return actual.existsSync(path)
    }),
  }
})

describe('PythonBridge bridge script validation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bridge 스크립트가 존재하지 않으면 명확한 에러를 던진다', async () => {
    // Import PythonBridge after the mock is set up
    const {PythonBridge} = await import('../src/providers/python/bridge.js')

    const bridge = new PythonBridge({module: 'test_module'})

    // call() internally calls ensureProcess() which checks existsSync
    await expect(bridge.call('test_fn', {})).rejects.toThrow(
      /Python bridge script not found/,
    )
  })
})
