import {join} from 'node:path'
import {existsSync, readdirSync} from 'node:fs'

export interface DiscoveryOptions {
  projectDir?: string    // default: process.cwd()
  cliName?: string       // for user-global path
}

export async function discoverManifests(options: DiscoveryOptions = {}): Promise<string[]> {
  const projectDir = options.projectDir ?? process.cwd()
  const paths: string[] = []

  // 1. Project-local: ./.union-cli/plugins/*.yaml
  const localDir = join(projectDir, '.union-cli', 'plugins')
  if (existsSync(localDir)) {
    paths.push(...findYamlFiles(localDir))
  }

  // 2. Project root plugins/: ./plugins/*.yaml
  const pluginsDir = join(projectDir, 'plugins')
  if (existsSync(pluginsDir)) {
    paths.push(...findYamlFiles(pluginsDir))
  }

  // 3. User-global: ~/.<cliName>/plugins/*.yaml (if cliName provided)
  if (options.cliName) {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
    const globalDir = join(homeDir, `.${options.cliName}`, 'plugins')
    if (existsSync(globalDir)) {
      paths.push(...findYamlFiles(globalDir))
    }
  }

  // 4. Environment variable: $UNION_CLI_PLUGINS_DIR
  const envDir = process.env.UNION_CLI_PLUGINS_DIR
  if (envDir && existsSync(envDir)) {
    paths.push(...findYamlFiles(envDir))
  }

  return paths
}

function findYamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('_'))
    .sort()
    .map((f) => join(dir, f))
}
