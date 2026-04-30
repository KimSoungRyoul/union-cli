import {describe, it, expect} from 'vitest'
import {parseManifestString, ManifestParseError} from '../src/manifest/parser.js'

const VALID_CLI_MANIFEST = `
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
    flags:
      - name: namespace
        char: "n"
        default: "default"
        cliMap: "-n {value}"
    examples:
      - "my-cli k8s pods list -n production"
`

const VALID_HTTP_MANIFEST = `
name: lona
namespace: lona
description: "LONA API"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com"
    timeout: 30000
commands:
  - id: loadtest:create
    description: "부하테스트 생성"
    http:
      method: POST
      path: "/loadtests"
    flags:
      - name: name
        required: true
        httpMap: body
      - name: target-url
        httpMap: body
        httpName: "targetUrl"
`

describe('Manifest Parser', () => {
  it('유효한 CLI manifest를 파싱한다', () => {
    const {manifest} = parseManifestString(VALID_CLI_MANIFEST)
    expect(manifest.name).toBe('k8s')
    expect(manifest.namespace).toBe('k8s')
    expect(manifest.provider.type).toBe('cli')
    expect(manifest.commands).toHaveLength(1)
    expect(manifest.commands[0].id).toBe('pods:list')
    expect(manifest.commands[0].flags).toHaveLength(1)
    expect(manifest.commands[0].flags![0].cliMap).toBe('-n {value}')
  })

  it('유효한 HTTP manifest를 파싱한다', () => {
    const {manifest} = parseManifestString(VALID_HTTP_MANIFEST)
    expect(manifest.name).toBe('lona')
    expect(manifest.provider.type).toBe('http')
    expect(manifest.commands).toHaveLength(1)
    expect(manifest.commands[0].http?.method).toBe('POST')
    expect(manifest.commands[0].flags![1].httpName).toBe('targetUrl')
  })

  it('잘못된 YAML을 거부한다', () => {
    expect(() => parseManifestString('{{invalid')).toThrow(ManifestParseError)
  })

  it('필수 필드 누락 시 에러를 반환한다', () => {
    const bad = `
name: test
namespace: test
description: "test"
provider:
  type: http
  config: {}
commands: []
`
    expect(() => parseManifestString(bad)).toThrow(ManifestParseError)
  })

  it('표준 플래그와 충돌하는 이름을 거부한다', () => {
    const bad = `
name: test
namespace: test
description: "test"
provider:
  type: http
  config: {}
commands:
  - id: items:list
    description: "목록"
    http:
      method: GET
      path: "/items"
    flags:
      - name: json
        description: "충돌!"
`
    expect(() => parseManifestString(bad)).toThrow(/표준 플래그와 충돌/)
  })

  it('provider type과 command config 불일치를 거부한다', () => {
    const bad = `
name: test
namespace: test
description: "test"
provider:
  type: cli
  config:
    binary: echo
commands:
  - id: items:list
    description: "목록"
    http:
      method: GET
      path: "/items"
`
    expect(() => parseManifestString(bad)).toThrow(/cli.*설정이 필요/)
  })

  it('잘못된 httpBodyType 값을 거부한다', () => {
    const bad = `
name: test
namespace: test
description: "test"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com"
commands:
  - id: items:list
    description: "목록"
    http:
      method: GET
      path: "/items"
    flags:
      - name: data
        httpMap: body
        httpBodyType: invalid
`
    expect(() => parseManifestString(bad)).toThrow(ManifestParseError)
  })

  it('유효한 httpBodyType 값을 허용한다', () => {
    const valid = `
name: test
namespace: test
description: "test"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com"
commands:
  - id: items:list
    description: "목록"
    http:
      method: GET
      path: "/items"
    flags:
      - name: config
        httpMap: body
        httpBodyType: json
      - name: tags
        httpMap: body
        httpBodyType: array
      - name: ids
        httpMap: body
        httpBodyType: number-array
`
    const {manifest} = parseManifestString(valid)
    expect(manifest.commands[0].flags![0].httpBodyType).toBe('json')
    expect(manifest.commands[0].flags![1].httpBodyType).toBe('array')
    expect(manifest.commands[0].flags![2].httpBodyType).toBe('number-array')
  })

  it('하이픈이 포함된 command ID를 허용한다', () => {
    const valid = `
name: test
namespace: test
description: "test"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com"
commands:
  - id: join-requests:list
    description: "참여 요청 목록"
    http:
      method: GET
      path: "/join-requests"
`
    const {manifest} = parseManifestString(valid)
    expect(manifest.commands[0].id).toBe('join-requests:list')
  })

  it('잘못된 outputParser 값을 거부한다', () => {
    const bad = `
name: test
namespace: test
description: "test"
provider:
  type: cli
  config:
    binary: echo
commands:
  - id: items:list
    description: "목록"
    cli:
      template: "list items"
    outputParser: invalid
`
    expect(() => parseManifestString(bad)).toThrow(ManifestParseError)
  })

  it('유효한 outputParser 값을 허용한다', () => {
    const valid = `
name: test
namespace: test
description: "test"
provider:
  type: cli
  config:
    binary: echo
commands:
  - id: items:list
    description: "목록"
    cli:
      template: "list items"
    outputParser: lines
`
    const {manifest} = parseManifestString(valid)
    expect(manifest.commands[0].outputParser).toBe('lines')
  })

  it('sensitive 플래그명에 대해 경고를 반환한다', () => {
    const yaml = `
name: test
namespace: test
description: "test"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com"
commands:
  - id: auth:login
    description: "로그인"
    http:
      method: POST
      path: "/auth/login"
    flags:
      - name: password
        description: "비밀번호"
      - name: token
        description: "토큰"
      - name: username
        description: "사용자명"
`
    const {warnings} = parseManifestString(yaml)
    expect(warnings).toHaveLength(2) // password, token
    expect(warnings[0].type).toBe('sensitive-flag')
    expect(warnings[0].message).toContain('password')
    expect(warnings[1].message).toContain('token')
  })
})
