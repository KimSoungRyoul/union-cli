import {describe, it, expect} from 'vitest'
import {CommandRegistry} from '../src/core/registry.js'
import type {PluginManifest} from '../src/core/types.js'

const cliManifest: PluginManifest = {
  name: 'k8s',
  namespace: 'k8s',
  description: 'Kubernetes CLI',
  provider: {
    type: 'cli',
    config: {binary: 'kubectl', globalFlags: ['-o', 'json']},
  },
  commands: [
    {
      id: 'pods:list',
      description: 'Pod 목록 조회',
      cli: {template: 'get pods'},
      flags: [{name: 'namespace', char: 'n', cliMap: '-n {value}'}],
      examples: ['my-cli k8s pods list'],
    },
    {
      id: 'pods:logs',
      description: 'Pod 로그',
      cli: {template: 'logs {name}'},
      args: [{name: 'name', required: true}],
      outputParser: 'lines',
    },
  ],
}

describe('CommandRegistry', () => {
  it('manifest를 등록하고 CommandSpec으로 변환한다', () => {
    const registry = new CommandRegistry()
    registry.register(cliManifest)

    const specs = registry.getAllSpecs()
    expect(specs).toHaveLength(2)

    const podsList = registry.get('k8s:pods:list')
    expect(podsList).toBeDefined()
    expect(podsList!.namespace).toBe('k8s')
    expect(podsList!.providerType).toBe('cli')
    expect(podsList!.providerConfig).toEqual({
      type: 'cli',
      cliTemplate: 'get pods',
      outputParser: 'json',
      overrideGlobalFlags: undefined,
    })
  })

  it('namespace별로 조회한다', () => {
    const registry = new CommandRegistry()
    registry.register(cliManifest)

    const k8sSpecs = registry.getByNamespace('k8s')
    expect(k8sSpecs).toHaveLength(2)
  })

  it('중복 namespace를 거부한다', () => {
    const registry = new CommandRegistry()
    registry.register(cliManifest)
    expect(() => registry.register(cliManifest)).toThrow(/already registered/)
  })

  it('CLI command의 outputParser를 올바르게 설정한다', () => {
    const registry = new CommandRegistry()
    registry.register(cliManifest)

    const logsSpec = registry.get('k8s:pods:logs')
    expect(logsSpec!.providerConfig).toEqual({
      type: 'cli',
      cliTemplate: 'logs {name}',
      outputParser: 'lines',
      overrideGlobalFlags: undefined,
    })
  })

  it('http command에 http config가 없으면 에러를 던진다', () => {
    const registry = new CommandRegistry()
    const badManifest: PluginManifest = {
      name: 'api',
      namespace: 'api',
      description: 'API',
      provider: {
        type: 'http',
        config: {baseUrl: 'https://example.com'},
      },
      commands: [
        {
          id: 'items:list',
          description: 'List items',
          // http config intentionally missing
        },
      ],
    }
    expect(() => registry.register(badManifest)).toThrow(/missing http configuration/)
  })

  it('cli command에 cli config가 없으면 에러를 던진다', () => {
    const registry = new CommandRegistry()
    const badManifest: PluginManifest = {
      name: 'tools',
      namespace: 'tools',
      description: 'Tools',
      provider: {
        type: 'cli',
        config: {binary: 'echo'},
      },
      commands: [
        {
          id: 'run:test',
          description: 'Run test',
          // cli config intentionally missing
        },
      ],
    }
    expect(() => registry.register(badManifest)).toThrow(/missing cli configuration/)
  })
})
