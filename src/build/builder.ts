import {parseManifestFile} from '../manifest/parser.js'
import {discoverManifests} from './discovery.js'
import {generateCommands} from './codegen.js'
import type {PluginManifest} from '../core/types.js'
import {writeFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'

export interface BuildOptions {
  projectDir?: string
  cliName?: string
  codegen?: boolean
  commandsDir?: string
}

export interface BuildResult {
  manifests: PluginManifest[]
  cachePath: string
  generatedFiles: string[]
  errors: string[]
  warnings: string[]
}

export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const projectDir = options.projectDir ?? process.cwd()
  const errors: string[] = []
  const warnings: string[] = []
  const manifests: PluginManifest[] = []
  const namespaces = new Set<string>()

  // 1. Discover manifest files
  const files = await discoverManifests(options)

  if (files.length === 0) {
    errors.push('manifest 파일을 찾을 수 없습니다. plugins/ 디렉토리에 YAML manifest를 작성하세요.')
    return {manifests, cachePath: '', generatedFiles: [], errors, warnings}
  }

  // 2. Parse each manifest
  for (const file of files) {
    try {
      const result = await parseManifestFile(file)
      // Check for duplicate namespace
      if (namespaces.has(result.manifest.namespace)) {
        errors.push(`중복된 namespace "${result.manifest.namespace}": ${file}`)
        continue
      }

      namespaces.add(result.manifest.namespace)
      manifests.push(result.manifest)

      // Collect validation warnings (e.g., sensitive flag names)
      for (const w of result.warnings) {
        warnings.push(w.message)
      }
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : error}`)
    }
  }

  // 3. Write cache file
  const cacheDir = join(projectDir, '.union-cli')
  await mkdir(cacheDir, {recursive: true})
  const cachePath = join(cacheDir, 'manifest.json')
  await writeFile(cachePath, JSON.stringify(manifests, null, 2))

  // 4. Code generation (optional)
  let generatedFiles: string[] = []
  if (options.codegen && manifests.length > 0) {
    const commandsDir = options.commandsDir ?? join(projectDir, 'dist', 'commands')
    generatedFiles = await generateCommands(manifests, commandsDir)
  }

  return {manifests, cachePath, generatedFiles, errors, warnings}
}
