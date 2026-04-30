# union-cli Framework Design

> YAML로 선언하고, build하면 통합 CLI가 만들어지는 프레임워크

---

## 0. 핵심 컨셉

### What is union-cli?

```
[YAML Manifests] --build--> [Your CLI binary] --run--> [Result]
```

YAML manifest 파일로 시스템 통합을 선언하면, 빌드 한 번으로 팀 전용 CLI가 생성된다.

```bash
# 1. 프로젝트 생성 (create-react-app 패턴)
npx create-union-cli <cli-name>
cd <cli-name>

# 2. YAML manifest 작성 (plugins/ 디렉토리)
plugins/my-api.yaml        # HTTP Provider — REST API
plugins/my-tool.yaml       # CLI Provider — 기존 CLI wrapping
plugins/my-sdk.yaml        # Python Provider — Python SDK
plugins/my-lib.yaml        # JS Provider — JS/TS 모듈

# 3. 빌드
npm run build               # → <cli-name> CLI 생성

# 4. 인증 & 사용
<cli> auth login
<cli> <namespace> <noun> <verb> [--flags]
```

> 예시 프로젝트: `examples/` 디렉토리에 HTTP/CLI/Python/JS Provider를 통합하는 샘플 CLI를 추가할 수 있다.

### 원본 설계 대비 변경사항

| 항목 | 원본 (unicli-design.md) | 변경 |
|------|------------------------|------|
| 프레임워크 이름 | unicli | **union-cli** |
| 빌드 개념 | 암묵적 (런타임 로딩 위주) | **명시적 build step 강조** |

---

## 1. CLI 설계 원칙 (clig.dev)

> 모든 설계 결정은 아래 원칙을 기준으로 판단한다. 상세 가이드: `cli-design-guide` skill 참조.

### 핵심 원칙

| 원칙 | 적용 |
|------|------|
| **Human-first, Machine-composable** | TTY면 사람용 포맷, `--json`이면 기계용 `ExecutionResult` 구조 |
| **Consistency** | 모든 namespace에서 동일한 flag 이름(`--json`, `--limit`), 동일한 에러 구조, 동일한 출력 포맷 |
| **Discoverability** | `--help`에 예시 선두 배치, 오타 교정 제안, 다음 명령 제안 |
| **Say Just Enough** | 성공 시 간결, 에러 시 해결 방법 포함, 100ms 안에 첫 출력 |
| **Robustness** | 입력 조기 검증, 멱등성, 크래시 후 복구 가능 |
| **Safety by Default** | 위험 동작 확인 요청, `--dry-run` 지원, 시크릿은 flag/env 수신 금지 |

### Command 구조 규칙

```
<cli> <namespace> <noun> <verb> [args] [--flags]
```

- noun-verb 순서 일관 유지
- catch-all subcommand 금지 (미래 확장성 보존)
- 임의 축약 금지 (`i`, `in`, `ins` 허용 시 새 command 추가 불가)
- flag를 arg보다 선호 (의미 명확, 순서 무관)

### 표준 Flag

**자동 주입 (모든 명령에 BaseCommand가 주입):**

```
--json          JSON 출력 (--format json 축약)
--debug         디버그 출력 (스택 트레이스, HTTP 로그)
-q, --quiet     최소 출력 (exitCode만)
--no-color      색상 비활성화 (NO_COLOR env와 동일)
--format <fmt>  출력 형식 (table|json|yaml|csv)
-h, --help      도움말
```

**명령별 선택 사용 (필요한 명령에서만 선언):**

```
-n, --dry-run    시뮬레이션
-f, --force      강제 실행 (확인 프롬프트 건너뛰기)
```

- YAML manifest에서 정의한 플래그가 표준 플래그와 이름 충돌 시 빌드 에러
- `helpGroup: 'GLOBAL'`로 도움말에서 표준 플래그와 명령 플래그 분리 표시

### Output 규칙

- TTY 감지 → 사람/기계 출력 자동 전환
- `--json`은 모든 command에서 동일한 `ExecutionResult` 구조 반환
- 색상: 에러=빨강, 성공=초록, 경고=노랑. `NO_COLOR`/`TERM=dumb`/`--no-color` 시 비활성화
- 긴 출력은 pager 자동 적용 (TTY일 때만)

### Error 규칙

- 통합 에러 구조: `{ code: "HTTP_401", message: "사람이 읽을 수 있는 설명", details? }`
- 대화형 메시지: "X를 할 수 없습니다. Y를 시도해보세요"
- 스택 트레이스는 `--debug` 시에만, 종료 코드: 0=성공, 1=일반, 2=사용법 오류

### 시크릿 처리

```
NEVER: --password 'secret'          # ps + shell history 노출
NEVER: MY_PASSWORD=secret cmd       # 자식 프로세스 전파
OK:    --password-file ./cred.txt   # 파일 참조
OK:    stdin pipe                   # 파이프 입력
OK:    secret manager               # vault 등
```

> 참고: manifest의 `env: "MY_PASSWORD"`는 **환경변수 이름 선언**이며,
> 실제 값은 런타임에 프로세스 내부에서만 읽고 자식 프로세스로 전파하지 않는다.

### 프레임워크 vs 빌드된 CLI 경로 구분

union-cli는 **프레임워크**이다. 이 프레임워크로 CLI를 빌드하면:

| 구분 | 경로 | 예시 |
|------|------|------|
| **프레임워크** (union-cli 자체) | `~/.config/union-cli/` | 플러그인 글로벌 탐색, 프레임워크 설정 |
| **빌드된 CLI** (실제 사용자 도구) | `~/.<cli-name>/` | `~/.my-cli/config.yaml`, `~/.my-cli/credentials/` |
| **프로젝트 로컬** (빌드 캐시) | `.union-cli/` | `.union-cli/manifest.json`, `.union-cli/plugins/` |

CLI 이름은 빌드 설정(package.json의 `name` 또는 manifest 루트의 `cliName`)에서 결정된다.
이하 문서에서 `<cli>` 또는 `<cli-name>`은 빌드된 CLI의 이름을 의미한다.

### 설정 우선순위 (높→낮)

```
1. 플래그
2. 현재 셸 환경변수
3. 프로젝트 .env
4. 프로젝트 설정 (.union-cli/config.yaml)
5. 사용자 설정 (~/<cli-name>/config.yaml)
```

### 설정 파일 경로 정리

- 빌드된 CLI 설정: `~/.<cli-name>/` — dotfile 패턴
- 프레임워크 설정: `~/.config/union-cli/` — XDG 규격
- 빌드 캐시: `.union-cli/` (프로젝트 로컬)

### 표준 빌트인 명령어 체계

빌드된 CLI(`<cli>`)가 기본 제공하는 표준 명령:

```
<cli>
├── init [--template] [--force]         # 프로젝트 초기화 (./.<cli-name>/ 생성)
├── build [--codegen] [--watch]         # YAML → CLI 빌드
├── doctor [--json]                     # 전체 provider 상태 확인
│
├── auth                                # 인증 관리 (중앙 집중형, gh auth 패턴)
│   ├── login [namespace]               # namespace 생략 시 전체 순차 로그인
│   ├── logout [namespace] [--all]      # 인증 해제
│   ├── status [namespace]              # 인증 상태 조회 (전체 또는 특정)
│   └── token <namespace>               # 토큰 stdout 출력 (파이프용)
│
├── config                              # 설정 관리
│   ├── set <key> <value> [--global]    # 설정값 저장
│   ├── get <key> [--global]            # 설정값 조회
│   ├── list [--global] [--json]        # 전체 설정 출력
│   └── reset [key] [--global] [--all]  # 설정 초기화
│
├── plugin                              # 플러그인 관리
│   ├── add <path|npm>
│   ├── list [--json]
│   └── remove <name>
│
├── codegen <plugin>                    # TS 코드 생성
├── completion install [shell]          # 셸 자동완성 (bash/zsh/fish)
├── help [command]                      # 도움말 (예시 우선 배치)
├── --version                           # 버전 정보
│
└── <namespace> ...                     # YAML manifest에서 생성된 동적 명령
    └── <noun> <verb> [args] [--flags]
```

### Auth 워크플로우

**중앙 집중형** — `<cli> auth login [namespace]` (gh auth 패턴):

- namespace 생략 시 → 등록된 모든 provider를 순차 로그인
- 특정 namespace만 로그인: `<cli> auth login <namespace>`
- 인증 상태 조회: `<cli> auth status`
- 토큰 파이프 출력: `<cli> auth token <namespace> | jq .`

**Credential 저장소:**
- 기본: FileStore (`~/.<cli-name>/credentials/<ns>.json`, 파일 권한 0600)
- 옵션: KeychainStore (macOS Keychain / Linux libsecret), EnvStore (CI/CD용)
- Non-TTY (스크립트): `--credential-file` 또는 stdin 필수

**auth-required 에러 처리:**
```
$ <cli> my-api dags list
Error: my-api namespace에 인증이 필요합니다.
  '<cli> auth login my-api' 를 실행하여 로그인하세요.
```

### 오타 교정 (Did you mean?)

```
$ <cli> myapi dags list
Error: 'myapi'은(는) 알 수 없는 명령입니다.
혹시 이 명령을 찾으셨나요?
  <cli> my-api dags list
```

- `@oclif/plugin-not-found` + Levenshtein 거리 기반
- 자동 실행 금지, 제안만 표시

---

## 2. 아키텍처 레이어

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: Interface Layer (YAML Manifests)                    │
│  plugins/*.yaml — 시스템 통합 선언 파일                         │
│  사용자가 직접 작성하는 유일한 파일                               │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: Build Layer                                        │
│  union-cli build → YAML 파싱 → CommandSpec 생성 → oclif 등록   │
│  Runtime Mode: init hook에서 동적 로딩                         │
│  Codegen Mode: TS command 파일 생성 (정적)                     │
├──────────────────────────────────────────────────────────────┤
│  Layer 3: CLI Layer (oclif)                                  │
│  <cli> <namespace> <command> [args] [--flags]                │
│  --json, --help, --format table|yaml                         │
├──────────────────────────────────────────────────────────────┤
│  Layer 4: Provider Layer                                     │
│  ┌────────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────┐ │
│  │HTTPProvider │ │CLIProvider│ │PythonProvider│ │ JSProvider│ │
│  │ fetch       │ │child_proc│ │JSON-RPC stdio│ │in-process │ │
│  │ OpenAPI gen │ │output parse│ │fn introspect│ │ESM import │ │
│  └────────────┘ └──────────┘ └──────────────┘ └───────────┘ │
├──────────────────────────────────────────────────────────────┤
│  Layer 5: Core                                               │
│  Config │ OutputFormatter │ AuthManager │ ErrorHandler        │
│  (clig.dev 원칙 구현: TTY 감지, 색상, 설정 우선순위, 에러 포맷) │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 디렉토리 구조

```
union-cli/
├── src/
│   ├── core/                        # Layer 5: Core
│   │   ├── types.ts                 # IProvider, ExecutionResult, CommandSpec 등 모든 타입
│   │   ├── base-command.ts          # BaseCommand — 표준 플래그 자동 주입 기반 클래스
│   │   ├── registry.ts              # CommandRegistry — manifest → CommandSpec 관리
│   │   ├── executor.ts              # 통합 실행 엔진 (provider 선택 → execute → format)
│   │   ├── output.ts                # OutputFormatter (json/table/yaml + TTY 감지 + 색상 + pager)
│   │   ├── config.ts                # 설정 관리 (~/<cli-name>/ 경로 파생)
│   │   ├── auth.ts                  # AuthManager (bearer, basic, jwt, api-key)
│   │   ├── credential-store.ts      # CredentialStore — credential 영속 관리 (File/Keychain/Env)
│   │   └── error.ts                 # ErrorHandler (대화형 에러 + 종료 코드 + --debug)
│   │
│   ├── manifest/                    # Layer 1 파서
│   │   ├── schema.ts                # JSON Schema 정의 (ajv용)
│   │   ├── parser.ts                # YAML → PluginManifest 파싱
│   │   └── validator.ts             # manifest 검증 + 친절한 에러 메시지
│   │
│   ├── providers/                   # Layer 4: Provider Layer
│   │   ├── http/
│   │   │   ├── provider.ts          # HTTPProvider — fetch 기반 REST 호출
│   │   │   ├── openapi-parser.ts    # OpenAPI spec → CommandSpec 자동 변환
│   │   │   └── auth-handlers.ts     # JWT, Bearer, Basic, API-Key 핸들러
│   │   ├── cli/
│   │   │   ├── provider.ts          # CLIProvider — child_process 래핑
│   │   │   ├── output-parser.ts     # stdout 파싱 (json/table/line/lines/csv/regex)
│   │   │   └── process.ts           # child_process 관리 (timeout, signal)
│   │   ├── python/
│   │   │   ├── provider.ts          # PythonProvider
│   │   │   ├── bridge.ts            # JSON-RPC over stdio 클라이언트
│   │   │   └── introspect.ts        # Python type hints → flag 타입 매핑
│   │   └── js/
│   │       ├── provider.ts          # JSProvider — in-process ESM/CJS import
│   │       └── loader.ts            # 모듈 로딩 (ESM/CJS 감지)
│   │
│   ├── build/                       # Layer 2: Build Layer
│   │   ├── builder.ts               # union-cli build 핵심 로직
│   │   ├── codegen.ts               # Static command TS 파일 생성
│   │   └── discovery.ts             # Plugin manifest 디스커버리
│   │
│   ├── commands/                    # Layer 3: 빌트인 명령
│   │   ├── init.ts                  # <cli> init
│   │   ├── build.ts                 # <cli> build
│   │   ├── doctor.ts                # <cli> doctor (health check)
│   │   ├── auth/
│   │   │   ├── login.ts
│   │   │   ├── logout.ts
│   │   │   ├── status.ts
│   │   │   └── token.ts
│   │   ├── config/
│   │   │   ├── set.ts
│   │   │   ├── get.ts
│   │   │   ├── list.ts
│   │   │   └── reset.ts
│   │   ├── plugin/
│   │   │   ├── add.ts
│   │   │   ├── list.ts
│   │   │   └── remove.ts
│   │   ├── completion/
│   │   │   └── install.ts
│   │   └── codegen.ts
│   │
│   ├── help.ts                      # oclif HelpBase 확장 (예시 우선 배치, 다음 명령 제안)
│   ├── hooks/
│   │   ├── init.ts                  # oclif init hook — 동적 command 등록
│   │   └── command-not-found.ts     # 오타 교정 (Did you mean?)
│   └── index.ts                     # oclif explicit strategy entry
│
├── bridge/
│   └── union_cli_bridge.py          # Python JSON-RPC 브릿지 (npm에 번들)
│
├── packages/
│   └── create-union-cli/            # npx create-union-cli 스캐폴더
│
├── examples/
│   └── <sample>/                    # 예시 프로젝트 (사용자 추가)
│
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 4. Provider 매핑 규칙

### YAML Manifest → TypeScript 타입 변환

YAML manifest는 중첩 객체 구조, TypeScript 타입은 flat 구조를 사용한다.
manifest parser가 아래 규칙에 따라 변환한다:

| YAML (manifest) | TypeScript (CommandSpec) | 설명 |
|-----------------|--------------------------|------|
| `http.method` | `HttpCommandConfig.method` | HTTP 메서드 |
| `http.path` | `HttpCommandConfig.path` | URL 경로 |
| `http.body` | `HttpCommandConfig.body` | 정적 body |
| `cli.template` | `CliCommandConfig.cliTemplate` | CLI 명령 템플릿 |
| `python.function` | `PythonCommandConfig.function` | Python 함수명 |
| `js.function` | `JsCommandConfig.function` | JS 함수명 |

### HTTP Provider — httpMap

```
httpMap: query   → URL query parameter (?key=value)
httpMap: body    → JSON request body 필드
httpMap: header  → HTTP request header
httpMap: path    → URL path parameter (args에서 자동 매핑되므로 보통 불필요)
```

`httpName`이 지정되면 HTTP 요청에서 해당 이름 사용 (CLI kebab-case ↔ API camelCase/snake_case 변환):

```yaml
flags:
  - name: target-url        # CLI: --target-url
    httpMap: body
    httpName: "targetUrl"    # HTTP body: {"targetUrl": "..."}
```

### CLI Provider — cliMap

```yaml
cliMap: "-n {value}"         → -n production
cliMap: "--replicas={value}" → --replicas=3
cliMap: "--all-namespaces"   → --all-namespaces (boolean)
```

- `globalFlags`: provider 전체에 적용되는 기본 플래그 (예: `["-o", "json"]`)
- `overrideGlobalFlags`: 특정 명령에서 globalFlags를 재정의
- `outputParser`: stdout 파싱 방식 (`json | line | lines | table | csv | yaml | regex`)

### Python Provider — pythonName

```yaml
pythonName: "entity_id"  → CLI --entity-id ↔ Python entity_id 변환
```

- `persistent: true`: 프로세스 유지 (빠른 반복 호출, `idleTimeout`으로 자동 종료)
- `persistent: false` (기본): 호출마다 새 프로세스

---

## 5. 핵심 타입 설계

```typescript
// ── IProvider: 모든 provider의 공통 계약 ──
interface IProvider<TConfig = unknown> {
  readonly type: 'http' | 'cli' | 'python' | 'js';
  resolveCommands(manifest: PluginManifest): CommandSpec[];
  execute(spec: CommandSpec, input: ExecutionInput): Promise<ExecutionResult>;
  healthCheck?(): Promise<HealthCheckResult>;
}

// ── ExecutionResult: 통합 출력 구조 ──
interface ExecutionResult {
  success: boolean;
  data: unknown;
  exitCode: number;
  duration: number;           // ms
  error?: {
    code: string;             // "HTTP_401", "PROCESS_TIMEOUT", "PARSE_ERROR"
    message: string;
    details?: unknown;
  };
}

// ── CommandSpec: subcommand 정의 ──
interface CommandSpec {
  id: string;                 // "my-api:dags:trigger"
  namespace: string;          // "my-api"
  description: string;
  args: ArgSpec[];
  flags: FlagSpec[];
  examples: string[];
  providerType: 'http' | 'cli' | 'python' | 'js';
  providerConfig: HttpCommandConfig | CliCommandConfig | PythonCommandConfig | JsCommandConfig;
}

// ── Provider별 Config ──
interface HttpCommandConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;               // "/dags/{dag_id}"
  body?: Record<string, unknown>;  // 정적 body (예: pause)
}

interface CliCommandConfig {
  cliTemplate: string;         // "get pod {name}"
  outputParser: 'json' | 'line' | 'lines' | 'table' | 'csv' | 'yaml' | 'regex';
  overrideGlobalFlags?: string[];
}

interface PythonCommandConfig {
  module: string;
  function: string;
}

interface JsCommandConfig {
  module: string;
  function: string;
}

// ── FlagSpec 확장: provider별 매핑 ──
interface FlagSpec {
  name: string;
  char?: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean';
  default?: unknown;
  options?: string[];
  description?: string;
  // CLI Provider
  cliMap?: string;             // "-n {value}", "--force --grace-period=0"
  // HTTP Provider
  httpMap?: 'query' | 'body' | 'header';
  httpName?: string;           // HTTP 필드명 (flag 이름과 다를 때)
  // Python Provider
  pythonName?: string;         // Python 인자명 (--entity-id → entity_id)
}

// ── Auth 설정 ──
interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'jwt' | 'api-key' | 'custom';
  // JWT 전용
  tokenEndpoint?: string;
  tokenTTL?: number;
  credentials?: {
    username?: SecretRef;
    password?: SecretRef;
  };
  // Bearer/API-Key
  token?: SecretRef;
  // API-Key
  headerName?: string;         // default: "X-API-Key"
}

interface SecretRef {
  env?: string;                // 환경변수
  command?: string;            // 명령 실행 결과
  file?: string;               // 파일 내용
  value?: string;              // 직접 지정 (개발용, 비권장)
}
```

---

## 6. 구현 Phase

### Phase 1: Core + Manifest + 프로젝트 기반

**목표:** oclif 프로젝트 부트스트랩 + 핵심 타입 + manifest 파서

**생성 파일:**

| 파일 | 설명 |
|------|------|
| `package.json` | oclif 프로젝트 설정 (name: union-cli, ESM, TypeScript) |
| `tsconfig.json` | TypeScript 설정 (ESM, strict) |
| `src/core/types.ts` | IProvider, ExecutionResult, CommandSpec, PluginManifest 등 전체 타입 |
| `src/core/base-command.ts` | BaseCommand — 표준 플래그 자동 주입 |
| `src/core/config.ts` | 설정 관리 (~/<cli-name>/ 경로 파생) |
| `src/core/output.ts` | OutputFormatter (json/table/yaml + TTY 감지 + 색상 + pager) |
| `src/core/error.ts` | ErrorHandler (대화형 에러 + 종료 코드 0/1/2 + --debug 스택 트레이스) |
| `src/core/auth.ts` | AuthManager (bearer, basic, jwt, api-key) |
| `src/core/credential-store.ts` | CredentialStore (FileStore/KeychainStore/EnvStore) |
| `src/core/registry.ts` | CommandRegistry (manifest → CommandSpec 변환 및 관리) |
| `src/core/executor.ts` | 통합 실행 엔진 |
| `src/manifest/schema.ts` | Manifest JSON Schema (ajv 검증용) |
| `src/manifest/parser.ts` | YAML 파싱 + schema 검증 |
| `src/manifest/validator.ts` | 심층 검증 + 친절한 에러 메시지 |

**의존성:**
```json
{
  "@oclif/core": "^4.x",
  "@oclif/plugin-help": "^6.x",
  "yaml": "^2.x",
  "ajv": "^8.x"
}
```

**검증:**
- `npm run build` 성공
- manifest parser 단위 테스트: 유효한 YAML → PluginManifest 객체
- manifest validator 단위 테스트: 잘못된 YAML → 대화형 에러 메시지
- OutputFormatter: TTY 감지 → 사람/기계 출력 자동 전환
- ErrorHandler: 종료 코드 매핑 (0/1/2) + `--debug` 시에만 스택 트레이스
- 설정 우선순위: 플래그 > env > .env > 프로젝트 > 사용자 설정

---

### Phase 2: CLI Provider

**목표:** CLI Provider 완성 + init hook 동적 command 등록

**생성 파일:**

| 파일 | 설명 |
|------|------|
| `src/providers/cli/provider.ts` | CLIProvider — child_process spawn + 결과 변환 |
| `src/providers/cli/output-parser.ts` | stdout 파서 (json, line, lines, table, csv, regex) |
| `src/providers/cli/process.ts` | child_process 래핑 (timeout, signal, stderr 처리) |
| `src/hooks/init.ts` | oclif init hook — YAML manifest → 동적 command 등록 |
| `src/index.ts` | oclif explicit strategy entry (COMMANDS export) |

**핵심 기능:**

```typescript
// cliTemplate 치환: "get pod {name}" + args → "get pod nginx-abc"
// cliMap 매핑: flag --namespace=prod → "-n prod"
// globalFlags: ["-o", "json"] (overrideGlobalFlags로 명령별 제어)
// outputParser: json | line | lines | table | csv | regex
```

**검증:** CLI Provider K8s manifest로 E2E 테스트

---

### Phase 3: HTTP Provider

**목표:** HTTP Provider 완성 (Bearer, JWT, Basic, API-Key 인증 지원)

**생성 파일:**

| 파일 | 설명 |
|------|------|
| `src/providers/http/provider.ts` | HTTPProvider — fetch 기반 REST 호출 |
| `src/providers/http/auth-handlers.ts` | JWT, Bearer, Basic, API-Key 인증 핸들러 |
| `src/providers/http/openapi-parser.ts` | OpenAPI spec → CommandSpec 자동 변환 |

**핵심 기능:**

```typescript
// path parameter 치환: "/resources/{id}/action" + args → "/resources/123/action"
// httpMap 매핑: query → URL query, body → JSON body, header → HTTP header
// httpName 변환: --target-url → targetUrl
// auth 핸들러:
//   bearer → 환경변수/파일에서 토큰 읽기
//   jwt    → POST tokenEndpoint → access_token 캐싱 → Bearer header
//   basic  → username:password base64 인코딩
//   api-key → X-API-Key header
```

**JWT Auth Flow:**
```
1. credentials에서 username/password 확보 (env/file/command)
2. POST {baseUrl + tokenEndpoint} → access_token 받기
3. tokenTTL 동안 메모리 캐싱
4. 이후 요청에 Authorization: Bearer {access_token} 헤더 추가
5. 401 응답 시 토큰 재발급 후 재시도 (1회)
```

**검증:** HTTP Provider manifest(REST API + 다양한 인증)로 E2E 테스트

---

### Phase 4: Build System

**목표:** `union-cli build` 명령으로 YAML → CLI 빌드 워크플로우 완성

**생성 파일:**

| 파일 | 설명 |
|------|------|
| `src/commands/build.ts` | `union-cli build` 명령 |
| `src/build/builder.ts` | 빌드 핵심 로직 (manifest 수집 → 검증 → 등록) |
| `src/build/discovery.ts` | Plugin manifest 디스커버리 (다중 경로 탐색) |
| `src/build/codegen.ts` | Codegen 모드: manifest → TS command 파일 생성 |

**Build 동작:**

```bash
# Runtime Mode (기본) — 빠른 개발
union-cli build
# → manifest 수집 → 검증 → .union-cli/manifest.json 캐시 생성
# → 다음 실행 시 init hook에서 캐시 로딩

# Codegen Mode — 타입 안전 + 빠른 시작
union-cli build --codegen
# → manifest → src/generated/<namespace>/*.ts 파일 생성
# → npm run build로 컴파일
```

**Plugin 디스커버리 순서:**
```
1. ./.union-cli/plugins/*.yaml       ← 프로젝트별
2. ~/.<cli-name>/plugins/*.yaml       ← 사용자 글로벌
3. node_modules/@union-cli/plugin-*   ← npm 패키지
4. $UNION_CLI_PLUGINS_DIR             ← 환경변수
```

**검증:**
- `union-cli build` → manifest 캐시 파일 생성
- 캐시 로딩 후 동적 명령 동작 확인
- `union-cli build --codegen` → generated TS 파일 확인
- 잘못된 manifest 시 명확한 에러 메시지

---

### Phase 5: Python Provider + JS Provider

**목표:** Python/JS 함수 호출 provider 완성

**생성 파일:**

| 파일 | 설명 |
|------|------|
| `src/providers/python/provider.ts` | PythonProvider |
| `src/providers/python/bridge.ts` | JSON-RPC over stdio 클라이언트 |
| `src/providers/python/introspect.ts` | Python type hints → flag 자동 매핑 |
| `src/providers/js/provider.ts` | JSProvider (in-process) |
| `src/providers/js/loader.ts` | ESM/CJS 모듈 로딩 |
| `bridge/union_cli_bridge.py` | Python JSON-RPC 브릿지 서버 |

**Python Bridge 아키텍처:**
```
union-cli (Node.js)              union_cli_bridge.py (Python)
     │                                    │
     ├── spawn(python, ["-m", "union_cli_bridge"])
     │         stdin ──→ {"method":"call","params":{...}}
     │         stdout ←── {"result":{...}}
     │                                    │
     ├── persistent mode: 프로세스 유지 (idleTimeout으로 자동 종료)
     └── oneshot mode: 호출마다 새 프로세스
```

**검증:** Python Provider manifest로 E2E 테스트

---

### Phase 6: 빌트인 명령 체계 완성

**목표:** 표준 빌트인 명령 전체 구현 + help 커스터마이징 + 셸 자동완성

**생성 파일:**

| 파일 | 설명 |
|------|------|
| `src/commands/init.ts` | `<cli> init` — 프로젝트 초기화 |
| `src/commands/auth/login.ts` | namespace별 인증 |
| `src/commands/auth/logout.ts` | 인증 해제 |
| `src/commands/auth/status.ts` | 인증 상태 조회 |
| `src/commands/auth/token.ts` | 토큰 stdout 출력 |
| `src/commands/config/set.ts` | 설정값 저장 |
| `src/commands/config/get.ts` | 설정값 조회 |
| `src/commands/config/list.ts` | 전체 설정 출력 |
| `src/commands/config/reset.ts` | 설정 초기화 |
| `src/commands/doctor.ts` | 모든 provider 상태 확인 |
| `src/commands/plugin/add.ts` | 플러그인 추가 |
| `src/commands/plugin/list.ts` | 플러그인 목록 |
| `src/commands/plugin/remove.ts` | 플러그인 제거 |
| `src/commands/completion/install.ts` | 셸 자동완성 |
| `src/commands/codegen.ts` | TS 코드 생성 |
| `src/help.ts` | oclif HelpBase 확장 |
| `src/hooks/command-not-found.ts` | 오타 교정 |

**추가 의존성:**
```json
{
  "@oclif/plugin-autocomplete": "^3.x",
  "@oclif/plugin-not-found": "^3.x"
}
```

**검증:**
- `<cli> init` → `.union-cli/` 디렉토리 생성 + 다음 단계 안내
- `<cli> auth login/status/token` 워크플로우 동작
- `<cli> config set/get/list` 왕복 검증
- `<cli> completion install zsh` → 자동완성 설치
- 오타 입력 → "Did you mean?" 제안
- `<cli> doctor --json` → provider health check
- 모든 command에 `--json`, `--debug`, `--quiet`, `--no-color` 동작 확인

---

### Phase 7: create-union-cli 스캐폴딩

**목표:** `npx create-union-cli <name>` 으로 프로젝트 생성 (create-react-app 패턴)

**생성 파일:**

| 파일 | 설명 |
|------|------|
| `packages/create-union-cli/index.ts` | 프로젝트 스캐폴더 진입점 |
| `packages/create-union-cli/templates/` | 기본 템플릿 |
| `packages/create-union-cli/package.json` | npm 패키지 설정 (bin: create-union-cli) |

**동작:**

```bash
npx create-union-cli my-tool
# → my-tool/ 디렉토리 생성
# → package.json (name: "my-tool", bin: {"my-tool": "./bin/run.js"})
# → tsconfig.json
# → .union-cli/config.yaml
# → plugins/ (빈 디렉토리 + 예시 yaml)
# → npm install
# → 다음 단계 안내

# 템플릿 옵션
npx create-union-cli my-tool --template http    # HTTP Provider 예시 포함
npx create-union-cli my-tool --template cli     # CLI Provider 예시 포함
npx create-union-cli my-tool --template full    # 모든 Provider 예시 포함
```

**검증:**
- 프로젝트 디렉토리 생성 + npm install 성공
- 생성된 프로젝트에서 `npm run build` 성공
- `--template` 옵션별 올바른 예시 manifest 생성

---

## 7. 의존성

```json
{
  "name": "union-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "union-cli": "./bin/run.js" },
  "dependencies": {
    "@oclif/core": "^4.x",
    "@oclif/plugin-help": "^6.x",
    "@oclif/plugin-not-found": "^3.x",
    "@oclif/plugin-autocomplete": "^3.x",
    "yaml": "^2.x",
    "ajv": "^8.x"
  },
  "devDependencies": {
    "@oclif/test": "^4.x",
    "typescript": "^5.x",
    "vitest": "^2.x"
  },
  "optionalDependencies": {
    "@apidevtools/swagger-parser": "^10.x",
    "keytar": "^7.x"
  }
}
```

---

## 8. 열린 설계 질문

| 질문 | 현재 판단 | 추후 결정 |
|------|---------|---------|
| Dynamic vs Static command | Phase 4에서 두 모드 모두 지원. 기본은 Runtime(동적) | Codegen 성능 비교 후 기본값 결정 |
| oclif command discovery 전략 | explicit strategy + init hook | 대규모 plugin 시 성능 프로파일링 |
| HTTP Provider retry 정책 | 401 시 JWT 재발급 1회, 그 외 미재시도 | manifest에 retry 설정 추가 검토 |
| Python Bridge 좀비 프로세스 | idleTimeout + SIGTERM → SIGKILL | 실전 테스트 후 튜닝 |
| Manifest schema 버전 관리 | v1으로 시작, `manifestVersion` 필드 예약 | 하위 호환 전략은 v2 필요 시 |
| OpenAPI 자동 생성 vs 수동 선언 | 수동 선언이 기본, OpenAPI는 보조 | OpenAPI → 수동 선언 변환 도구 검토 |
| Credential 기본 저장소 | FileStore (0600). CI/CD 호환성 우선 | keytar 안정화 후 기본값 전환 검토 |
| auth login 대화형 vs 비대화형 | TTY 감지로 자동 전환. Non-TTY는 credential-file/stdin | 브라우저 OAuth 플로우 추가 검토 |
