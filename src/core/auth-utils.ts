import type {PluginManifest, HttpProviderConfig, AuthConfig} from './types.js'

/** Extract AuthConfig from a manifest's provider config */
export function getAuthConfig(manifest: PluginManifest): AuthConfig | undefined {
  const config = manifest.provider.config as HttpProviderConfig
  return config?.auth
}

/** Get the executor from globalThis or throw */
export function getExecutor(): {registry: {getAllManifests(): PluginManifest[]}} {
  const executor = (globalThis as Record<string, unknown>).__unionCliExecutor as
    {registry: {getAllManifests(): PluginManifest[]}} | undefined
  if (!executor) throw new Error('Executor not initialized. Run "build" first.')
  return executor
}

/** Resolve environment variable references: ${VAR_NAME} or ${VAR_NAME:-default} */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [envKey, defaultValue] = expr.split(':-')
    return process.env[envKey] ?? defaultValue ?? ''
  })
}

/** Determine if color/emoji should be suppressed */
export function isNoColor(flags: Record<string, unknown>): boolean {
  return Boolean(flags['no-color']) || process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb'
}
