// ── Provider 타입 ──

export type ProviderType = 'http' | 'cli' | 'python' | 'js';

export interface IProvider<_TConfig = unknown> {
  readonly type: ProviderType;
  resolveCommands(manifest: PluginManifest): CommandSpec[];
  execute(spec: CommandSpec, input: ExecutionInput): Promise<ExecutionResult>;
  healthCheck?(): Promise<HealthCheckResult>;
}

// ── 실행 결과 ──

export interface ExecutionResult {
  success: boolean;
  data: unknown;
  exitCode: number;
  duration: number;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ExecutionInput {
  args: Record<string, unknown>;
  flags: Record<string, unknown>;
  raw: string[];
}

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  details?: unknown;
}

// ── Command 정의 ──

export interface CommandSpec {
  id: string;
  namespace: string;
  description: string;
  args: ArgSpec[];
  flags: FlagSpec[];
  examples: string[];
  providerType: ProviderType;
  providerConfig: ProviderCommandConfig;
}

export type ProviderCommandConfig =
  | HttpCommandConfig
  | CliCommandConfig
  | PythonCommandConfig
  | JsCommandConfig;

export interface HttpCommandConfig {
  type: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

export interface CliCommandConfig {
  type: 'cli';
  cliTemplate: string;
  outputParser: OutputParserType;
  overrideGlobalFlags?: string[];
}

export interface PythonCommandConfig {
  type: 'python';
  module: string;
  function: string;
}

export interface JsCommandConfig {
  type: 'js';
  module: string;
  function: string;
}

export type OutputParserType = 'json' | 'line' | 'lines' | 'table' | 'csv' | 'yaml';

// ── Flag / Arg 정의 ──

export interface FlagSpec {
  name: string;
  char?: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean';
  default?: unknown;
  options?: string[];
  description?: string;
  // CLI Provider
  cliMap?: string;
  // HTTP Provider
  httpMap?: 'query' | 'body' | 'header';
  httpName?: string;
  /**
   * body 값의 타입 힌트.
   * - 'json': 문자열을 JSON.parse
   * - 'array': 콤마 구분 → string[]
   * - 'number-array': 콤마 구분 → number[]
   * - 'json-string-array': JSON 파싱 후 각 원소를 JSON.stringify → string[] (API가 문자열 배열을 기대할 때)
   */
  httpBodyType?: 'json' | 'array' | 'number-array' | 'json-string-array';
  /** 플래그 값의 출처. 'file'이면 값을 파일 경로로 해석하여 내용을 읽음 */
  valueFrom?: 'file';
  /**
   * query 값이 배열일 때 직렬화 방식.
   * - 'repeat' (기본): `?key=a&key=b`
   * - 'csv'         : `?key=a,b`
   */
  httpQueryType?: 'csv' | 'repeat';
  // Python Provider
  pythonName?: string;
}

export interface ArgSpec {
  name: string;
  required?: boolean;
  description?: string;
  default?: unknown;
}

// ── Manifest (YAML 파싱 결과) ──

export interface PluginManifest {
  name: string;
  namespace: string;
  description: string;
  provider: ProviderConfig;
  commands: ManifestCommand[];
}

export interface ProviderConfig {
  type: ProviderType;
  config: HttpProviderConfig | CliProviderConfig | PythonProviderConfig | JsProviderConfig;
}

// ── Provider별 Config ──

export interface HttpProviderConfig {
  baseUrl: string;
  auth?: AuthConfig;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface CliProviderConfig {
  binary: string;
  globalFlags?: string[];
}

export interface PythonProviderConfig {
  module: string;
  persistent?: boolean;
  idleTimeout?: number;
  venv?: string;
}

export interface JsProviderConfig {
  module: string;
}

// ── Auth ──

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'jwt' | 'api-key' | 'cookie' | 'device-code' | 'custom';
  tokenEndpoint?: string;
  tokenTTL?: number;
  credentials?: {
    username?: SecretRef;
    password?: SecretRef;
  };
  token?: SecretRef;
  headerName?: string;
  /** cookie 인증 시 토큰 파일 경로 (기본: .union-cli/tokens.json) */
  tokenFile?: string;
  /** cookie 인증 시 서비스 이름 (토큰 파일의 키) */
  serviceName?: string;
  /**
   * cookie 인증 시 Bearer 토큰으로 추출할 쿠키 이름(정확 매칭).
   * 지정되지 않으면 serviceName 기반(`${serviceName}_token=`) → 이전 heuristic 순으로 폴백.
   */
  cookieName?: string;
  /** OIDC token request 형식: 'json' (기본) | 'form' (application/x-www-form-urlencoded, Keycloak 등) */
  tokenRequestFormat?: 'json' | 'form';
  /** OIDC client_id (tokenRequestFormat=form에서 사용) */
  clientId?: string;
  /** OIDC client_secret (Confidential client용) */
  clientSecret?: SecretRef;
  /** OIDC grant_type (기본: 'password') */
  grantType?: string;
  /** OIDC scope (예: 'openid') */
  scope?: string;
  /** Device Code Flow: device authorization endpoint URL */
  deviceAuthEndpoint?: string;
}

export interface SecretRef {
  env?: string;
  command?: string;
  file?: string;
  value?: string;
}

// ── Manifest Command (YAML 원본 구조) ──

export interface ManifestCommand {
  id: string;
  description: string;
  http?: {
    method: string;
    path: string;
    body?: Record<string, unknown>;
  };
  cli?: {
    template: string;
  };
  python?: {
    function: string;
  };
  js?: {
    function: string;
  };
  args?: ArgSpec[];
  flags?: FlagSpec[];
  examples?: string[];
  outputParser?: OutputParserType;
  overrideGlobalFlags?: string[];
  /** 위험한 동작 표시. true이면 실행 전 확인 프롬프트 표시, --force로 건너뛸 수 있음 */
  dangerous?: boolean;
  /** 성공 시 표시할 메시지. 플레이스홀더 {argName} 사용 가능 */
  successMessage?: string;
}
