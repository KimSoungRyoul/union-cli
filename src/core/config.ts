import {mkdirSync, existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
import YAML from 'yaml'

export class ConfigManager {
  private readonly _configDir: string
  private readonly _credentialsDir: string
  private readonly _projectDir: string

  constructor(cliName: string) {
    this._configDir = join(homedir(), `.${cliName}`)
    this._credentialsDir = join(this._configDir, 'credentials')
    this._projectDir = '.union-cli'
  }

  get configDir(): string {
    return this._configDir
  }

  get credentialsDir(): string {
    return this._credentialsDir
  }

  get projectDir(): string {
    return this._projectDir
  }

  async get(key: string): Promise<unknown> {
    const config = await this.readConfig()
    return config[key]
  }

  async set(key: string, value: unknown): Promise<void> {
    const config = await this.readConfig()
    config[key] = value
    await this.writeConfig(config)
  }

  async list(): Promise<Record<string, unknown>> {
    return this.readConfig()
  }

  private get configFilePath(): string {
    return join(this._configDir, 'config.yaml')
  }

  private async readConfig(): Promise<Record<string, unknown>> {
    this.ensureDirectories()
    const filePath = this.configFilePath

    if (!existsSync(filePath)) {
      return {}
    }

    const content = await readFile(filePath, 'utf-8')
    if (!content.trim()) {
      return {}
    }

    const parsed = YAML.parse(content)
    return (parsed as Record<string, unknown>) ?? {}
  }

  private async writeConfig(config: Record<string, unknown>): Promise<void> {
    this.ensureDirectories()
    const content = YAML.stringify(config)
    await writeFile(this.configFilePath, content, 'utf-8')
  }

  private ensureDirectories(): void {
    mkdirSync(this._configDir, {recursive: true})
    mkdirSync(this._credentialsDir, {recursive: true})
  }
}
