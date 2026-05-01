import {Command, Args, Flags} from '@oclif/core'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join, resolve} from 'node:path'
import YAML from 'yaml'
import {convertOpenApiToManifests} from '../build/openapi-to-manifest.js'

export default class Codegen extends Command {
  static override description =
    'OpenAPI 3.x spec → manifest YAML 변환. tag 별 1 manifest 생성.'

  static override examples = [
    'union-cli codegen ./openapi.json',
    'union-cli codegen ./openapi.json --out plugins/ --base-url "${API_BASE:-http://localhost:8080}"',
    'union-cli codegen ./openapi.json --single --name-prefix mycli',
  ]

  static override args = {
    spec: Args.string({
      required: true,
      description: 'OpenAPI 3.x spec 파일 경로 (JSON 또는 YAML) 또는 URL',
    }),
  }

  static override flags = {
    out: Flags.string({
      description: '출력 디렉토리. 미지정 시 ./plugins',
      default: './plugins',
    }),
    'base-url': Flags.string({
      description: 'manifest 의 baseUrl. 미지정 시 servers[0].url',
    }),
    'name-prefix': Flags.string({
      description: 'manifest name 의 prefix. 미지정 시 spec.info.title',
    }),
    'auth-type': Flags.string({
      description: 'auth.type 기본값',
      options: ['none', 'bearer', 'jwt', 'api-key', 'cookie', 'basic', 'device-code'],
      default: 'none',
    }),
    single: Flags.boolean({
      description: '단일 manifest (tag 별 split 안 함)',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: '기존 파일 덮어쓰기',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: '파일 쓰지 않고 stdout 으로 출력',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Codegen)

    // 1) spec 읽기 (file 만 지원, URL 은 v2)
    const specPath = resolve(args.spec)
    if (!existsSync(specPath)) {
      this.error(`spec 파일을 찾을 수 없습니다: ${specPath} (URL 입력은 v2 에서 지원)`)
    }
    const raw = await readFile(specPath, 'utf-8')
    let spec: unknown
    try {
      spec = specPath.endsWith('.yaml') || specPath.endsWith('.yml') ? YAML.parse(raw) : JSON.parse(raw)
    } catch (err) {
      this.error(`spec 파싱 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!spec || typeof spec !== 'object') {
      this.error('spec 이 객체가 아닙니다')
    }

    // 2) 변환
    const result = convertOpenApiToManifests(spec as never, {
      baseUrl: flags['base-url'],
      namePrefix: flags['name-prefix'],
      authType: flags['auth-type'],
      split: !flags.single,
    })

    // 3) 출력
    if (flags['dry-run']) {
      for (const m of result.manifests) {
        this.log(`# === ${m.namespace}.yaml ===`)
        this.log(YAML.stringify(m))
        this.log('')
      }
      for (const w of result.warnings) this.logToStderr(`[warn] ${w}`)
      this.log(`\n생성: ${result.manifests.length} manifest, 명령 ${result.manifests.reduce((n, m) => n + m.commands.length, 0)} 개`)
      return
    }

    const outDir = resolve(flags.out)
    if (!existsSync(outDir)) await mkdir(outDir, {recursive: true})
    const written: string[] = []
    for (const m of result.manifests) {
      const filePath = join(outDir, `${m.namespace}.yaml`)
      if (existsSync(filePath) && !flags.force) {
        this.warn(`이미 존재함 (skip, --force 로 덮어쓰기): ${filePath}`)
        continue
      }
      await writeFile(filePath, YAML.stringify(m), 'utf-8')
      written.push(filePath)
    }

    for (const w of result.warnings) this.logToStderr(`[warn] ${w}`)
    this.log(`✓ ${written.length} manifest 파일 생성:`)
    for (const f of written) this.log(`  - ${f}`)
    if (written.length === 0) this.log('  (변경 없음. --force 로 덮어쓰기 가능)')
  }
}
