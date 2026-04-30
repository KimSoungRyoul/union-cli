import type {
  CommandSpec,
  PluginManifest,
  ProviderCommandConfig,
  ProviderType,
  HttpCommandConfig,
  CliCommandConfig,
  PythonCommandConfig,
  JsCommandConfig,
} from './types.js'

export class CommandRegistry {
  private specs = new Map<string, CommandSpec>()
  private namespaces = new Map<string, PluginManifest>()

  register(manifest: PluginManifest): void {
    if (this.namespaces.has(manifest.namespace)) {
      throw new Error(`Namespace "${manifest.namespace}" is already registered.`)
    }

    this.namespaces.set(manifest.namespace, manifest)

    for (const cmd of manifest.commands) {
      const spec = this.toCommandSpec(cmd, manifest)
      const fullId = `${manifest.namespace}:${cmd.id}`
      this.specs.set(fullId, spec)
    }
  }

  get(id: string): CommandSpec | undefined {
    return this.specs.get(id)
  }

  getByNamespace(namespace: string): CommandSpec[] {
    return [...this.specs.values()].filter((s) => s.namespace === namespace)
  }

  getAllSpecs(): CommandSpec[] {
    return [...this.specs.values()]
  }

  getAllManifests(): PluginManifest[] {
    return [...this.namespaces.values()]
  }

  private toCommandSpec(cmd: PluginManifest['commands'][number], manifest: PluginManifest): CommandSpec {
    return {
      id: `${manifest.namespace}:${cmd.id}`,
      namespace: manifest.namespace,
      description: cmd.description,
      args: cmd.args ?? [],
      flags: cmd.flags ?? [],
      examples: cmd.examples ?? [],
      providerType: manifest.provider.type,
      providerConfig: this.toProviderConfig(cmd, manifest.provider.type, manifest),
    }
  }

  private toProviderConfig(
    cmd: PluginManifest['commands'][number],
    providerType: ProviderType,
    manifest: PluginManifest,
  ): ProviderCommandConfig {
    switch (providerType) {
      case 'http': {
        if (!cmd.http) {
          throw new Error(`Command "${cmd.id}" is type "http" but missing http configuration`)
        }
        const http = cmd.http
        return {
          type: 'http',
          method: http.method as HttpCommandConfig['method'],
          path: http.path,
          body: http.body,
        } satisfies HttpCommandConfig
      }

      case 'cli': {
        if (!cmd.cli) {
          throw new Error(`Command "${cmd.id}" is type "cli" but missing cli configuration`)
        }
        const cli = cmd.cli
        return {
          type: 'cli',
          cliTemplate: cli.template,
          outputParser: cmd.outputParser ?? 'json',
          overrideGlobalFlags: cmd.overrideGlobalFlags,
        } satisfies CliCommandConfig
      }

      case 'python': {
        if (!cmd.python) {
          throw new Error(`Command "${cmd.id}" is type "python" but missing python configuration`)
        }
        const py = cmd.python
        return {
          type: 'python',
          module: (manifest.provider.config as {module: string}).module,
          function: py.function,
        } satisfies PythonCommandConfig
      }

      case 'js': {
        if (!cmd.js) {
          throw new Error(`Command "${cmd.id}" is type "js" but missing js configuration`)
        }
        const js = cmd.js
        return {
          type: 'js',
          module: (manifest.provider.config as {module: string}).module,
          function: js.function,
        } satisfies JsCommandConfig
      }
    }
  }
}
