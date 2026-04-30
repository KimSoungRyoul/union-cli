import {Command, Args, Flags} from '@oclif/core'
import {execFile} from 'node:child_process'
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {chmod} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join, resolve, isAbsolute} from 'node:path'
import {promisify} from 'node:util'

const execFileP = promisify(execFile)

// ── Plugin Registry ──
//
// Single source of truth for installed plugin records.
// Stored at ~/.<cli-name>/plugins.json with 0600 permissions.
//
// Structure:
//   {
//     "version": 1,
//     "plugins": [
//       {
//         "name": "@team/foo",
//         "source": "npm",
//         "spec": "@team/foo",          // raw user input (npm pkg, path, git url)
//         "installedAt": "ISO-8601",
//         "manifestPaths": ["..."]      // absolute paths to discovered yaml files
//       }
//     ]
//   }

export type PluginSourceKind = 'npm' | 'file' | 'git'

export interface PluginRecord {
  name: string
  source: PluginSourceKind
  spec: string
  installedAt: string
  manifestPaths: string[]
}

export interface PluginRegistry {
  version: number
  plugins: PluginRecord[]
}

export const REGISTRY_VERSION = 1

export function registryPath(cliName: string): string {
  return join(homedir(), `.${cliName}`, 'plugins.json')
}

export function loadRegistry(cliName: string): PluginRegistry {
  const path = registryPath(cliName)
  if (!existsSync(path)) {
    return {version: REGISTRY_VERSION, plugins: []}
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    if (!raw.trim()) return {version: REGISTRY_VERSION, plugins: []}
    const parsed = JSON.parse(raw) as Partial<PluginRegistry>
    return {
      version: parsed.version ?? REGISTRY_VERSION,
      plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
    }
  } catch {
    return {version: REGISTRY_VERSION, plugins: []}
  }
}

export async function saveRegistry(cliName: string, registry: PluginRegistry): Promise<void> {
  const path = registryPath(cliName)
  const dir = join(homedir(), `.${cliName}`)
  mkdirSync(dir, {recursive: true})
  writeFileSync(path, JSON.stringify(registry, null, 2), 'utf-8')
  // 0600 — registry can leak install paths; keep owner-only.
  try {
    await chmod(path, 0o600)
  } catch {
    // best-effort on platforms that don't support chmod
  }
}

// ── Source classification ──

export function classifySource(source: string): PluginSourceKind {
  // 1. Local path indicators take precedence — these never go to npm/git.
  if (
    source.startsWith('./') ||
    source.startsWith('../') ||
    source === '.' ||
    source === '..' ||
    source.startsWith('~/') ||
    isAbsolute(source) ||
    source.startsWith('file:')
  ) {
    return 'file'
  }

  // 2. Explicit git URLs.
  if (
    source.startsWith('git+') ||
    source.startsWith('git://') ||
    source.startsWith('git@') ||
    source.startsWith('https://') ||
    source.startsWith('http://')
  ) {
    return 'git'
  }

  // 3. user/repo shorthand: a single slash, no leading dot/scope, not a path on disk.
  //    Only treat as git when local does not exist — this lets ambiguous values
  //    fall through to file when the user happens to have that directory.
  if (/^[A-Za-z0-9_-][\w-]*\/[\w.-]+$/.test(source) && !existsSync(source)) {
    return 'git'
  }

  // 4. Path that exists on disk → file.
  if (existsSync(source)) {
    return 'file'
  }

  // 5. Default: npm package (incl. @scope/name).
  return 'npm'
}

function expandTilde(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (p.startsWith('file://')) return p.slice('file://'.length)
  return p
}

// ── Manifest discovery within a directory ──

function findYamlFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map((f) => join(dir, f))
}

/**
 * Discover plugin manifest files for a given installation root.
 * Looks for `<root>/plugins/*.yaml`, `<root>/<root>/plugins/*.yaml` (npm pkg name),
 * and falls back to a single .yaml file if root is a file.
 */
export function discoverManifestsForRoot(root: string): string[] {
  if (!existsSync(root)) return []
  const stat = statSync(root)
  if (stat.isFile()) {
    if (root.endsWith('.yaml') || root.endsWith('.yml')) return [root]
    return []
  }
  // directory: prefer `<root>/plugins/`, fall back to `<root>/` itself
  const inPlugins = findYamlFilesIn(join(root, 'plugins'))
  if (inPlugins.length > 0) return inPlugins
  return findYamlFilesIn(root)
}

// ── npm wrappers ──

interface NpmInstallOptions {
  cwd: string
  spec: string
}

export interface NpmRunner {
  install(options: NpmInstallOptions): Promise<void>
  resolvePackagePath(cwd: string, pkgName: string): string | null
  packageNameFromSpec(cwd: string, spec: string): Promise<string>
}

export const defaultNpmRunner: NpmRunner = {
  async install({cwd, spec}: NpmInstallOptions): Promise<void> {
    await execFileP('npm', ['install', '--save', spec], {cwd, env: {...process.env}})
  },
  resolvePackagePath(cwd: string, pkgName: string): string | null {
    const dir = join(cwd, 'node_modules', pkgName)
    return existsSync(dir) ? dir : null
  },
  async packageNameFromSpec(cwd: string, spec: string): Promise<string> {
    // For scoped or simple npm packages, name == spec without version suffix.
    // For git/url specs, fall back to reading installed package.json from node_modules.
    const versionStripped = spec.replace(/@[^/@]+$/, '')
    if (/^@?[\w.-]+(\/[\w.-]+)?$/.test(versionStripped) && !spec.includes('://')) {
      return versionStripped
    }
    // Try to find newest entry in node_modules — best effort.
    const nm = join(cwd, 'node_modules')
    if (!existsSync(nm)) return spec
    const entries = readdirSync(nm).filter((d) => !d.startsWith('.'))
    for (const e of entries) {
      const pj = join(nm, e, 'package.json')
      if (existsSync(pj)) {
        try {
          const pkg = JSON.parse(readFileSync(pj, 'utf-8')) as {name?: string; _resolved?: string}
          if (pkg._resolved && pkg._resolved.includes(spec)) return pkg.name ?? e
        } catch {
          // skip
        }
      }
    }
    return spec
  },
}

// Allow tests to inject a mock runner via globalThis without touching env.
function getNpmRunner(): NpmRunner {
  const injected = (globalThis as Record<string, unknown>).__unionCliNpmRunner as NpmRunner | undefined
  return injected ?? defaultNpmRunner
}

// ── Command ──

export default class PluginAdd extends Command {
  static override description = '플러그인 추가 (npm 패키지 / 로컬 경로 / git URL)'

  static override examples = [
    '<%= config.bin %> plugin add ./my-plugin',
    '<%= config.bin %> plugin add @team/foo-plugin',
    '<%= config.bin %> plugin add git+https://github.com/user/repo.git',
  ]

  static override args = {
    source: Args.string({required: true, description: '플러그인 경로, npm 패키지명 또는 git URL'}),
  }

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(PluginAdd)
    const cliName = this.config.bin
    const source = args.source
    const kind = classifySource(source)

    let name: string
    let manifestPaths: string[] = []

    try {
      if (kind === 'file') {
        const expanded = expandTilde(source)
        const abs = resolve(process.cwd(), expanded)
        if (!existsSync(abs)) {
          this.error(`경로를 찾을 수 없습니다: ${source}`)
        }
        manifestPaths = discoverManifestsForRoot(abs)
        if (manifestPaths.length === 0) {
          this.error(`매니페스트(*.yaml)를 찾을 수 없습니다: ${abs}`)
        }
        name = abs
      } else {
        // npm or git: delegate to npm install
        const runner = getNpmRunner()
        try {
          await runner.install({cwd: process.cwd(), spec: source})
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.error(`npm install 실패: ${msg}`)
        }
        name = await runner.packageNameFromSpec(process.cwd(), source)
        const pkgPath = runner.resolvePackagePath(process.cwd(), name)
        if (!pkgPath) {
          this.error(`설치된 패키지를 찾을 수 없습니다: ${name}`)
        }
        manifestPaths = discoverManifestsForRoot(pkgPath)
        if (manifestPaths.length === 0) {
          this.warn(`매니페스트(plugins/*.yaml)를 찾지 못했습니다: ${name} (계속 등록)`)
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('EEXIT')) throw err
      const msg = err instanceof Error ? err.message : String(err)
      this.error(`플러그인 추가 실패: ${msg}`)
    }

    // Update registry — replace any existing entry with same name.
    const registry = loadRegistry(cliName)
    registry.plugins = registry.plugins.filter((p) => p.name !== name)
    const record: PluginRecord = {
      name,
      source: kind,
      spec: source,
      installedAt: new Date().toISOString(),
      manifestPaths,
    }
    registry.plugins.push(record)
    await saveRegistry(cliName, registry)

    if (flags.json) {
      this.log(JSON.stringify({action: 'add', plugin: record}, null, 2))
      return
    }
    this.log(`✓ 플러그인 추가: ${name}`)
    this.log(`  source: ${kind} (${source})`)
    this.log(`  매니페스트: ${manifestPaths.length}개`)
    for (const p of manifestPaths) this.log(`    - ${p}`)
  }
}
