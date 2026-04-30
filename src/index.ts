export {BaseCommand} from './core/base-command.js'
export {CommandRegistry} from './core/registry.js'
export {Executor} from './core/executor.js'
export {parseManifestFile, parseManifestString, ManifestParseError, type ParseResult} from './manifest/parser.js'
export {logger} from './core/logger.js'
export {CACHE_DIR, MANIFEST_FILE, MANIFEST_CACHE_PATH} from './core/constants.js'
export {
  getTokensPath,
  loadTokens,
  saveTokens,
  deleteTokenForNamespace,
  deleteAllTokens,
  decryptChromeCookies,
  discoverProfiles,
  decryptCookieValue,
} from './core/token-store.js'
export type {
  IProvider,
  ExecutionResult,
  ExecutionInput,
  CommandSpec,
  FlagSpec,
  ArgSpec,
  PluginManifest,
  ProviderType,
  ProviderConfig,
  AuthConfig,
  SecretRef,
} from './core/types.js'
