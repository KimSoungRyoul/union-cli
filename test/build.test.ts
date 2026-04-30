import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {discoverManifests} from '../src/build/discovery.js'
import {build} from '../src/build/builder.js'
import {generateCommands} from '../src/build/codegen.js'
import type {PluginManifest} from '../src/core/types.js'

const VALID_MANIFEST_YAML = `
name: k8s
namespace: k8s
description: "Kubernetes CLI"
provider:
  type: cli
  config:
    binary: kubectl
    globalFlags: ["-o", "json"]
commands:
  - id: pods:list
    description: "Pod 목록 조회"
    cli:
      template: "get pods"
`

const VALID_MANIFEST_YAML_2 = `
name: docker
namespace: docker
description: "Docker CLI"
provider:
  type: cli
  config:
    binary: docker
commands:
  - id: containers:list
    description: "컨테이너 목록"
    cli:
      template: "ps"
`

const INVALID_MANIFEST_YAML = `
name: bad
description: "missing namespace and commands"
`

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'union-cli-test-'))
})

afterEach(() => {
  rmSync(tempDir, {recursive: true, force: true})
})

describe('discoverManifests', () => {
  it('plugins/ 디렉토리에서 yaml 파일을 찾는다', async () => {
    const pluginsDir = join(tempDir, 'plugins')
    mkdirSync(pluginsDir, {recursive: true})
    writeFileSync(join(pluginsDir, 'k8s.yaml'), VALID_MANIFEST_YAML)
    writeFileSync(join(pluginsDir, 'docker.yml'), VALID_MANIFEST_YAML_2)

    const files = await discoverManifests({projectDir: tempDir})
    expect(files).toHaveLength(2)
    expect(files[0]).toContain('docker.yml')
    expect(files[1]).toContain('k8s.yaml')
  })

  it('yaml 파일이 없으면 빈 배열을 반환한다', async () => {
    const files = await discoverManifests({projectDir: tempDir})
    expect(files).toEqual([])
  })

  it('yaml/yml 이외의 파일은 무시한다', async () => {
    const pluginsDir = join(tempDir, 'plugins')
    mkdirSync(pluginsDir, {recursive: true})
    writeFileSync(join(pluginsDir, 'k8s.yaml'), VALID_MANIFEST_YAML)
    writeFileSync(join(pluginsDir, 'readme.txt'), 'not a manifest')
    writeFileSync(join(pluginsDir, 'data.json'), '{}')

    const files = await discoverManifests({projectDir: tempDir})
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('k8s.yaml')
  })

  it('.union-cli/plugins/ 디렉토리에서도 찾는다', async () => {
    const localDir = join(tempDir, '.union-cli', 'plugins')
    mkdirSync(localDir, {recursive: true})
    writeFileSync(join(localDir, 'k8s.yaml'), VALID_MANIFEST_YAML)

    const files = await discoverManifests({projectDir: tempDir})
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('.union-cli')
  })

  it('여러 소스의 파일을 합쳐서 반환한다', async () => {
    const localDir = join(tempDir, '.union-cli', 'plugins')
    const pluginsDir = join(tempDir, 'plugins')
    mkdirSync(localDir, {recursive: true})
    mkdirSync(pluginsDir, {recursive: true})
    writeFileSync(join(localDir, 'local.yaml'), VALID_MANIFEST_YAML)
    writeFileSync(join(pluginsDir, 'project.yaml'), VALID_MANIFEST_YAML_2)

    const files = await discoverManifests({projectDir: tempDir})
    expect(files).toHaveLength(2)
  })
})

describe('build', () => {
  it('유효한 manifest를 빌드하고 캐시 파일을 생성한다', async () => {
    const pluginsDir = join(tempDir, 'plugins')
    mkdirSync(pluginsDir, {recursive: true})
    writeFileSync(join(pluginsDir, 'k8s.yaml'), VALID_MANIFEST_YAML)

    const result = await build({projectDir: tempDir})

    expect(result.errors).toEqual([])
    expect(result.manifests).toHaveLength(1)
    expect(result.manifests[0].namespace).toBe('k8s')
    expect(result.cachePath).toContain('manifest.json')
    expect(existsSync(result.cachePath)).toBe(true)

    const cached = JSON.parse(readFileSync(result.cachePath, 'utf-8'))
    expect(cached).toHaveLength(1)
    expect(cached[0].namespace).toBe('k8s')
  })

  it('잘못된 manifest에 대해 에러를 보고한다', async () => {
    const pluginsDir = join(tempDir, 'plugins')
    mkdirSync(pluginsDir, {recursive: true})
    writeFileSync(join(pluginsDir, 'bad.yaml'), INVALID_MANIFEST_YAML)

    const result = await build({projectDir: tempDir})

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('bad.yaml')
    expect(result.manifests).toHaveLength(0)
  })

  it('중복된 namespace를 감지한다', async () => {
    const pluginsDir = join(tempDir, 'plugins')
    mkdirSync(pluginsDir, {recursive: true})
    writeFileSync(join(pluginsDir, 'a-k8s.yaml'), VALID_MANIFEST_YAML)
    // Same namespace "k8s" in a different file
    writeFileSync(join(pluginsDir, 'b-k8s-dup.yaml'), VALID_MANIFEST_YAML)

    const result = await build({projectDir: tempDir})

    expect(result.manifests).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('중복된 namespace')
    expect(result.errors[0]).toContain('k8s')
  })

  it('manifest 파일이 없으면 에러를 반환한다', async () => {
    const result = await build({projectDir: tempDir})

    expect(result.manifests).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('manifest 파일을 찾을 수 없습니다')
    expect(result.cachePath).toBe('')
  })

  it('유효한 manifest와 잘못된 manifest가 섞여 있어도 부분 빌드한다', async () => {
    const pluginsDir = join(tempDir, 'plugins')
    mkdirSync(pluginsDir, {recursive: true})
    writeFileSync(join(pluginsDir, 'a-good.yaml'), VALID_MANIFEST_YAML)
    writeFileSync(join(pluginsDir, 'b-bad.yaml'), INVALID_MANIFEST_YAML)

    const result = await build({projectDir: tempDir})

    expect(result.manifests).toHaveLength(1)
    expect(result.manifests[0].namespace).toBe('k8s')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('b-bad.yaml')
  })
})

// ── generateCommands: codegen 세부 테스트 ──

describe('generateCommands — codegen', () => {
  it('dangerous: true인 커맨드는 확인 프롬프트 코드를 포함한다', async () => {
    const manifest: PluginManifest = {
      name: 'infra',
      namespace: 'infra',
      description: 'Infra management',
      provider: {
        type: 'http',
        config: {baseUrl: 'http://localhost:3000'},
      },
      commands: [
        {
          id: 'cluster:destroy',
          description: 'Destroy a cluster',
          dangerous: true,
          http: {method: 'DELETE', path: '/clusters/{id}'},
        },
      ],
    }

    const outputDir = join(tempDir, 'codegen-dangerous')
    const files = await generateCommands([manifest], outputDir)

    expect(files.length).toBeGreaterThanOrEqual(1)
    // Find the generated command file (not builtin files)
    const cmdFile = files.find(f => f.includes('cluster'))
    expect(cmdFile).toBeDefined()

    const code = readFileSync(cmdFile!, 'utf-8')
    // Should include readline import for confirmation prompt
    expect(code).toContain("import {createInterface} from 'node:readline'")
    // Should include force flag
    expect(code).toContain('force: Flags.boolean')
    // Should include confirmation prompt text
    expect(code).toContain('정말 실행하시겠습니까?')
    // Should include cancel message
    expect(code).toContain('취소되었습니다')
  })

  it('dangerous: false 또는 미지정 커맨드는 확인 프롬프트가 없다', async () => {
    const manifest: PluginManifest = {
      name: 'infra',
      namespace: 'infra',
      description: 'Infra management',
      provider: {
        type: 'http',
        config: {baseUrl: 'http://localhost:3000'},
      },
      commands: [
        {
          id: 'cluster:list',
          description: 'List clusters',
          http: {method: 'GET', path: '/clusters'},
        },
      ],
    }

    const outputDir = join(tempDir, 'codegen-safe')
    const files = await generateCommands([manifest], outputDir)

    const cmdFile = files.find(f => f.includes('cluster'))
    expect(cmdFile).toBeDefined()

    const code = readFileSync(cmdFile!, 'utf-8')
    expect(code).not.toContain("import {createInterface} from 'node:readline'")
    expect(code).not.toContain('force: Flags.boolean')
    expect(code).not.toContain('정말 실행하시겠습니까?')
  })

  it('successMessage가 지정된 커맨드는 성공 메시지 출력 코드를 포함한다', async () => {
    const manifest: PluginManifest = {
      name: 'deploy',
      namespace: 'deploy',
      description: 'Deployment',
      provider: {
        type: 'http',
        config: {baseUrl: 'http://localhost:3000'},
      },
      commands: [
        {
          id: 'app:create',
          description: 'Create an app',
          successMessage: 'App {name} created successfully!',
          http: {method: 'POST', path: '/apps'},
          flags: [{name: 'name', httpMap: 'body'}],
        },
      ],
    }

    const outputDir = join(tempDir, 'codegen-success-msg')
    const files = await generateCommands([manifest], outputDir)

    const cmdFile = files.find(f => f.includes('app'))
    expect(cmdFile).toBeDefined()

    const code = readFileSync(cmdFile!, 'utf-8')
    // Should include the success message string
    expect(code).toContain('App {name} created successfully!')
    // Should include stderr output (to avoid pipe contamination)
    expect(code).toContain('this.logToStderr(msg)')
    // Should include placeholder replacement logic
    expect(code).toContain('msg.replace')
  })

  it('successMessage가 없는 POST 커맨드는 기본 상태 변경 알림을 포함한다', async () => {
    const manifest: PluginManifest = {
      name: 'api',
      namespace: 'api',
      description: 'API service',
      provider: {
        type: 'http',
        config: {baseUrl: 'http://localhost:3000'},
      },
      commands: [
        {
          id: 'data:update',
          description: 'Update data',
          http: {method: 'POST', path: '/data'},
        },
      ],
    }

    const outputDir = join(tempDir, 'codegen-default-msg')
    const files = await generateCommands([manifest], outputDir)

    const cmdFile = files.find(f => f.includes('data'))
    expect(cmdFile).toBeDefined()

    const code = readFileSync(cmdFile!, 'utf-8')
    // Should include default POST completion message with method name
    expect(code).toContain('POST 요청 완료')
  })

  it('boolean 타입 플래그가 Flags.boolean()으로 생성된다', async () => {
    const manifest: PluginManifest = {
      name: 'tools',
      namespace: 'tools',
      description: 'Tools',
      provider: {
        type: 'http',
        config: {baseUrl: 'http://localhost:3000'},
      },
      commands: [
        {
          id: 'run:exec',
          description: 'Execute a run',
          http: {method: 'POST', path: '/runs'},
          flags: [
            {name: 'verbose', type: 'boolean', description: 'Verbose output'},
            {name: 'dry-run', type: 'boolean', char: 'd', description: 'Dry run mode'},
            {name: 'count', type: 'number', description: 'Repeat count'},
            {name: 'label', type: 'string', description: 'Run label'},
          ],
        },
      ],
    }

    const outputDir = join(tempDir, 'codegen-flags')
    const files = await generateCommands([manifest], outputDir)

    const cmdFile = files.find(f => f.includes('run'))
    expect(cmdFile).toBeDefined()

    const code = readFileSync(cmdFile!, 'utf-8')
    // Boolean flags should use Flags.boolean()
    expect(code).toContain('verbose: Flags.boolean({description: "Verbose output"})')
    // Hyphenated flag names should be quoted
    expect(code).toContain("'dry-run': Flags.boolean({description: \"Dry run mode\", char: \"d\"})")
    // Number flags should use Flags.custom()
    expect(code).toContain('count: Flags.custom({description: "Repeat count"')
    // String flags should use Flags.string()
    expect(code).toContain('label: Flags.string({description: "Run label"})')
  })
})
