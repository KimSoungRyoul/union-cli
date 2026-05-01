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

/**
 * 등록된 Manifest 와 그로부터 펼쳐낸 CommandSpec 들을 추적하는 in-memory 레지스트리.
 *
 * Build/init 단계에서 `register()` 로 manifest 가 들어오고, runtime 에서
 * `${namespace}:${commandId}` 키로 spec 을 lookup 한다. 동일 namespace 중복 등록은 throw —
 * 같은 이름의 plugin 이 두 번 로드되면 어느 것이 우선인지 모호해지기 때문.
 */
export class CommandRegistry {
  private specs = new Map<string, CommandSpec>()
  private namespaces = new Map<string, PluginManifest>()

  /**
   * Manifest 를 등록하고 각 command 를 정규화된 CommandSpec 으로 펼쳐 저장한다.
   * @param manifest - 검증된 PluginManifest
   * @throws {Error} 동일 namespace 가 이미 등록된 경우
   */
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

  /**
   * 전체 ID 로 CommandSpec 을 조회한다.
   * @param id - `${namespace}:${command.id}` 형식의 전체 ID
   * @returns 등록된 CommandSpec, 없으면 undefined
   */
  get(id: string): CommandSpec | undefined {
    return this.specs.get(id)
  }

  /**
   * 특정 namespace 에 속한 모든 CommandSpec 을 반환한다.
   * @param namespace - manifest namespace
   * @returns 해당 namespace 의 CommandSpec 배열 (없으면 빈 배열)
   */
  getByNamespace(namespace: string): CommandSpec[] {
    return [...this.specs.values()].filter((s) => s.namespace === namespace)
  }

  /**
   * 등록된 모든 CommandSpec 을 반환한다 (codegen / 도움말 생성용).
   * @returns 모든 CommandSpec 의 배열
   */
  getAllSpecs(): CommandSpec[] {
    return [...this.specs.values()]
  }

  /**
   * 등록된 모든 PluginManifest 를 반환한다.
   * @returns 모든 PluginManifest 의 배열
   */
  getAllManifests(): PluginManifest[] {
    return [...this.namespaces.values()]
  }

  /** ManifestCommand → CommandSpec 변환 (provider config 포함). */
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

  /**
   * provider type 별 분기 — manifest 의 raw command 를 provider 가 소비할 수 있는
   * config 형태로 변환한다. 누락된 섹션은 명시적 에러를 던져 manifest 작성자가
   * 빠르게 원인을 파악할 수 있게 한다.
   */
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
          // 명령 단위 timeout override — provider.config.timeout 보다 우선 (provider.ts 가 사용)
          ...(cmd.timeout !== undefined ? {timeout: cmd.timeout} : {}),
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
