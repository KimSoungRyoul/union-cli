# Architecture - 아키텍처 문서

union-cli는 YAML 선언 한 장으로 팀 전용 통합 CLI를 만드는 프레임워크입니다. 이 문서에서는 내부 아키텍처를 상세히 설명합니다.

---

## 5-Layer 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Interface                                             │
│  plugins/*.yaml -- 사용자가 작성하는 유일한 파일                    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Build                                                 │
│  YAML 파싱 -> 검증 -> Codegen (oclif Command JS 파일 생성)        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: CLI (oclif)                                           │
│  커맨드 파싱, 표준 플래그, 도움말, 자동완성                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: Provider                                              │
│  HTTP (fetch) / CLI (spawn) / Python (JSON-RPC) / JS (ESM)      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: Core Infrastructure                                   │
│  Auth / Output / Config / CredentialStore / Error               │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1: Interface (YAML Manifest)

사용자가 작성하는 유일한 파일입니다. `plugins/` 디렉토리에 YAML manifest를 배치합니다.

- **역할**: CLI 커맨드, Provider 설정, 인증, 플래그를 선언적으로 정의
- **위치**: `plugins/*.yaml`, `.union-cli/plugins/*.yaml`, 또는 `$UNION_CLI_PLUGINS_DIR`
- **원칙**: 코드 없이 YAML만으로 커맨드를 정의

```yaml
name: my-api
namespace: api
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
commands:
  - id: users:list
    description: "사용자 목록"
    http: { method: GET, path: "/users" }
```

### Layer 2: Build (빌드 파이프라인)

YAML manifest를 oclif 커맨드 JS 파일로 변환하는 빌드 단계입니다.

- **역할**: YAML 탐색 -> 파싱 -> 스키마 검증 -> 의미 검증 -> JS 코드 생성
- **입력**: `plugins/*.yaml`
- **출력**: `dist/commands/<namespace>/<topic>/<action>.js` + `.union-cli/manifest.json`

### Layer 3: CLI (oclif)

[oclif](https://oclif.io/) 프레임워크가 제공하는 CLI 런타임 레이어입니다.

- **역할**: 커맨드 파싱, 표준 플래그(`--json`, `--format`, `--quiet`, `--debug`, `--no-color`), 도움말(`--help`), 자동완성
- **BaseCommand**: 모든 생성된 커맨드가 상속하는 기본 클래스. 표준 플래그를 정의하고 출력 형식을 결정

### Layer 4: Provider

실제 작업을 수행하는 실행 엔진입니다. 4가지 Provider 타입을 지원합니다:

| Provider | 실행 방식 | 사용 사례 |
|----------|-----------|-----------|
| HTTP | `fetch()` | REST API 호출 |
| CLI | `child_process.spawn()` | 외부 CLI 바이너리 래핑 (kubectl, terraform 등) |
| Python | JSON-RPC over stdio | Python SDK/라이브러리 호출 |
| JS | in-process ESM/CJS `import()` | Node.js 모듈 직접 호출 |

### Layer 5: Core Infrastructure

모든 레이어에서 공유하는 핵심 인프라입니다:

| 컴포넌트 | 역할 |
|----------|------|
| Auth | 인증 헤더 생성 (Bearer, Basic, JWT, API-Key, Cookie) |
| Output | 출력 형식 변환 (table, json, yaml, csv) |
| Config | 설정 관리 (`~/.my-cli/config.yaml`) |
| CredentialStore | 인증 정보 저장 (`.union-cli/tokens.json`) |
| Error | 통합 에러 처리, 에러 코드, 사용자 친화적 메시지 |

---

## 실행 흐름

사용자가 커맨드를 실행하면 다음 순서로 처리됩니다:

```
$ my-cli api users create --name "John" --email "john@example.com" --json

1. oclif 초기화
   └─ init hook: manifest.json 로드 -> Executor/Provider 등록
                 globalThis.__unionCliExecutor = executor

2. oclif 커맨드 파싱
   └─ dist/commands/api/users/create.js 로드
   └─ args, flags 파싱: { name: "John", email: "john@example.com", json: true }

3. Executor 호출
   └─ executor.execute("api:users:create", { args, flags, raw })
   └─ CommandRegistry에서 CommandSpec 조회
   └─ namespace "api" -> HTTPProvider 선택

4. HTTPProvider 실행
   └─ URL 구성: baseUrl + path -> "https://api.example.com/v1/users"
   └─ Query 파라미터 구성: httpMap: "query" 플래그들
   └─ Request Body 구성: httpMap: "body" 플래그들
      { "name": "John", "email": "john@example.com" }
   └─ 인증 헤더 주입: Bearer/Cookie/JWT/...
   └─ fetch() 실행: POST https://api.example.com/v1/users

5. 출력
   └─ --json 플래그 감지 -> JSON.stringify(result.data)
   └─ stdout에 출력
```

---

## 디렉토리 구조

```
src/
├── core/                     # Layer 5: Core Infrastructure
│   ├── types.ts              # 모든 TypeScript 인터페이스 정의
│   ├── registry.ts           # CommandRegistry - 커맨드 등록/조회
│   ├── executor.ts           # Executor - Provider 선택 및 실행 조율
│   ├── base-command.ts       # BaseCommand - 표준 플래그 정의
│   ├── auth.ts               # AuthManager - 인증 헤더 생성
│   ├── credential-store.ts   # CredentialStore - 인증 정보 저장/조회
│   ├── config.ts             # ConfigManager - 설정 관리
│   ├── output.ts             # OutputFormatter - 출력 형식 변환
│   └── error.ts              # UnifiedError - 통합 에러 처리
│
├── manifest/                 # Layer 2: Build (파싱/검증)
│   ├── schema.ts             # AJV JSON Schema 정의
│   ├── parser.ts             # YAML 파싱 + 스키마 검증
│   └── validator.ts          # 의미 검증 (중복 ID, 플래그 충돌 등)
│
├── providers/                # Layer 4: Provider
│   ├── http/
│   │   ├── provider.ts       # HTTPProvider - fetch 기반 HTTP 호출
│   │   └── auth-handlers.ts  # 인증 타입별 헤더 적용
│   ├── cli/
│   │   ├── provider.ts       # CLIProvider - 외부 바이너리 래핑
│   │   ├── process.ts        # child_process.spawn 래퍼
│   │   └── output-parser.ts  # CLI 출력 파서 (json, line, table, csv, yaml)
│   ├── python/
│   │   ├── provider.ts       # PythonProvider - Python 함수 호출
│   │   ├── bridge.ts         # PythonBridge - JSON-RPC over stdio
│   │   └── introspect.ts     # Python 모듈 자동 탐색
│   └── js/
│       ├── provider.ts       # JSProvider - Node.js 모듈 호출
│       └── loader.ts         # ESM/CJS 모듈 로더
│
├── build/                    # Layer 2: Build (코드 생성)
│   ├── discovery.ts          # Manifest 파일 탐색
│   ├── builder.ts            # 빌드 오케스트레이션
│   └── codegen.ts            # oclif Command JS 코드 생성
│
├── commands/                 # Built-in 커맨드 (개발/관리용)
│   ├── auth/
│   │   ├── login.ts          # auth login
│   │   ├── logout.ts         # auth logout
│   │   ├── status.ts         # auth status
│   │   └── token.ts          # auth token (파이프용)
│   ├── config/
│   │   ├── get.ts            # config get <key>
│   │   ├── set.ts            # config set <key> <value>
│   │   ├── list.ts           # config list
│   │   └── reset.ts          # config reset [key]
│   ├── plugin/
│   │   ├── add.ts            # plugin add <source>
│   │   ├── remove.ts         # plugin remove <name>
│   │   └── list.ts           # plugin list
│   ├── completion/
│   │   └── install.ts        # completion install [shell]
│   ├── build.ts              # build (YAML -> CLI)
│   ├── codegen.ts            # codegen <plugin>
│   ├── doctor.ts             # doctor (시스템 진단)
│   └── init.ts               # init (프로젝트 초기화)
│
├── hooks/
│   └── init.ts               # oclif init hook - manifest 로드 + Provider 등록
│
└── index.ts                  # 공개 API export
```

---

## 핵심 컴포넌트

### CommandRegistry

커맨드 정의(CommandSpec)를 관리하는 중앙 레지스트리입니다.

```typescript
interface CommandSpec {
  id: string;              // "api:users:list" (namespace:topic:action)
  namespace: string;       // "api"
  description: string;
  args: ArgSpec[];
  flags: FlagSpec[];
  examples: string[];
  providerType: ProviderType;
  providerConfig: ProviderCommandConfig;
}
```

주요 메서드:

| 메서드 | 설명 |
|--------|------|
| `register(manifest)` | PluginManifest를 등록. 중복 namespace면 에러 |
| `get(id)` | 전체 ID(`namespace:topic:action`)로 CommandSpec 조회 |
| `getByNamespace(ns)` | 특정 namespace의 모든 CommandSpec 조회 |
| `getAllSpecs()` | 등록된 모든 CommandSpec 조회 |
| `getAllManifests()` | 등록된 모든 PluginManifest 조회 |

### Executor

Provider를 선택하고 커맨드 실행을 조율하는 오케스트레이터입니다.

```typescript
class Executor {
  registerProvider(namespace: string, provider: IProvider): void;
  registerManifest(manifest: PluginManifest): void;
  execute(specId: string, input: ExecutionInput): Promise<ExecutionResult>;
}
```

실행 결과:

```typescript
interface ExecutionResult {
  success: boolean;
  data: unknown;       // Provider가 반환한 데이터
  exitCode: number;    // 0: 성공, 1: 에러, 2: 사용법 에러
  duration: number;    // 실행 시간 (ms)
  error?: {
    code: string;      // "HTTP_404", "CLI_ERROR", "PYTHON_ERROR" 등
    message: string;
    details?: unknown;
  };
}
```

### BaseCommand

모든 생성된 커맨드가 상속하는 oclif Command 기본 클래스입니다.

표준 플래그:

| 플래그 | 단축키 | 설명 |
|--------|--------|------|
| `--json` | | JSON 출력 |
| `--debug` | | 디버그 출력 (에러 상세 포함) |
| `--quiet` | `-q` | 최소 출력 (exit code만 반환) |
| `--no-color` | | 색상/이모지 비활성화 |
| `--format` | | 출력 형식 (`table`, `json`, `yaml`, `csv`) |

### CredentialStore

인증 정보를 파일 시스템에 저장하고 관리합니다.

두 가지 구현체:
- **FileCredentialStore**: 파일 기반 (`~/.my-cli/credentials/<namespace>.json`). 파일 권한 `0600` 설정
- **EnvCredentialStore**: 환경변수 기반 (`<NAMESPACE>_TOKEN`). 읽기 전용

SecretRef 해석 (`resolveSecret`):

| 소스 | 설명 | 예시 |
|------|------|------|
| `env` | 환경변수에서 읽기 | `env: "MY_TOKEN"` |
| `file` | 파일에서 읽기 | `file: "/path/to/token.txt"` |
| `command` | 커맨드 실행 결과 | `command: "vault read -field=token secret/api"` |
| `value` | 직접 값 (테스트용) | `value: "literal-token"` |

---

## 빌드 파이프라인

`npm run build` 실행 시 다음 단계가 순서대로 진행됩니다:

### 1. Manifest 탐색 (Discovery)

4개 위치에서 YAML manifest 파일을 탐색합니다:

```
탐색 순서:
1. .union-cli/plugins/*.yaml      (프로젝트 로컬)
2. plugins/*.yaml                  (프로젝트 루트)
3. ~/.<cliName>/plugins/*.yaml     (사용자 글로벌)
4. $UNION_CLI_PLUGINS_DIR/*.yaml   (환경변수 지정)
```

### 2. YAML 파싱 (Parse)

각 YAML 파일을 파싱하고 JSON Schema(AJV)로 구조를 검증합니다.

필수 필드: `name`, `namespace`, `description`, `provider`, `commands`

namespace 규칙: 소문자 영문 + 숫자 + 하이픈, 소문자로 시작 (`^[a-z][a-z0-9-]*$`)

command ID 규칙: `topic:action` 형태 (`^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`)

### 3. 의미 검증 (Validate)

스키마 검증을 통과한 후 추가적인 의미 검증을 수행합니다:

- **중복 command ID 검사**: 같은 manifest 내에서 동일한 ID가 있으면 에러
- **Provider-Command 매칭**: HTTP provider인데 `http` 설정이 없으면 에러
- **표준 플래그 충돌**: `--json`, `--debug`, `--quiet`, `--no-color`, `--format`, `--help`과 이름이 같으면 에러
- **단축키 충돌**: `-h`, `-q` 단축키 사용 시 에러
- **민감 플래그 경고**: `password`, `secret`, `token` 등의 이름이면 경고 (ps/history 노출 위험)

### 4. 코드 생성 (Codegen)

각 manifest 커맨드에 대해 oclif Command JS 파일을 생성합니다:

```
plugins/my-api.yaml
  commands:
    - id: users:list      -> dist/commands/api/users/list.js
    - id: users:create    -> dist/commands/api/users/create.js
```

생성되는 파일 구조: `dist/commands/<namespace>/<topic>/<action>.js`

추가로 Built-in 커맨드도 함께 생성됩니다:
- `dist/commands/auth/login.js`
- `dist/commands/auth/status.js`
- `dist/commands/auth/logout.js`
- `dist/commands/doctor.js`

### 5. 캐시 저장

파싱된 manifest를 `.union-cli/manifest.json`에 캐시합니다. 이 파일은 CLI 실행 시 init hook에서 읽어 Executor와 Provider를 초기화하는 데 사용됩니다.

---

## Init Hook 흐름

CLI가 실행될 때 oclif의 init hook이 가장 먼저 동작합니다:

```
CLI 시작
  └─ oclif init hook 실행
     └─ .union-cli/manifest.json 읽기
     └─ 각 manifest에 대해:
        ├─ executor.registerManifest(manifest)   # CommandRegistry에 등록
        └─ executor.registerProvider(namespace, new HTTPProvider(...))  # Provider 등록
     └─ globalThis.__unionCliExecutor = executor  # 전역 접근 가능
```

codegen으로 생성된 커맨드 파일은 `globalThis.__unionCliExecutor`를 통해 Executor에 접근하여 커맨드를 실행합니다.

---

## 환경변수 치환

manifest의 `baseUrl` 등에서 환경변수를 참조할 수 있습니다:

```yaml
baseUrl: "${BASE_URL:-https://default.example.com}/api/v1"
```

문법: `${VAR_NAME}` 또는 `${VAR_NAME:-기본값}`

환경변수 치환은 init hook과 codegen 단계에서 각각 수행됩니다.
