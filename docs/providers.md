# Providers - Provider 상세 가이드

Provider는 union-cli에서 실제 작업을 수행하는 실행 엔진입니다. 4가지 Provider 타입을 지원하며, 각각 다른 백엔드 시스템과 통신합니다.

---

## Provider 개념

모든 Provider는 `IProvider` 인터페이스를 구현합니다:

```typescript
interface IProvider {
  readonly type: ProviderType;   // 'http' | 'cli' | 'python' | 'js'
  resolveCommands(manifest: PluginManifest): CommandSpec[];
  execute(spec: CommandSpec, input: ExecutionInput): Promise<ExecutionResult>;
  healthCheck?(): Promise<HealthCheckResult>;
}
```

- `execute()`: 커맨드의 args와 flags를 받아 Provider별 방식으로 실행하고 `ExecutionResult`를 반환합니다.
- `healthCheck()`: Provider의 연결 상태를 확인합니다 (`doctor` 커맨드에서 사용).

---

## HTTP Provider

REST API를 `fetch()`로 호출합니다. 가장 일반적으로 사용되는 Provider입니다.

### Provider 설정

```yaml
provider:
  type: http
  config:
    baseUrl: "${BASE_URL:-https://api.example.com}/v1"   # 환경변수 지원
    auth: { ... }                # 인증 설정 (auth.md 참조)
    headers:                     # 모든 요청에 포함할 기본 헤더
      X-Custom-Header: "value"
      Accept: "application/json"
    timeout: 30000               # 요청 타임아웃 (ms, 기본 30000)
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `baseUrl` | string | Y | | API 기본 URL. 환경변수 치환(`${VAR:-default}`) 지원 |
| `auth` | AuthConfig | N | | 인증 설정 (none, bearer, basic, jwt, api-key, cookie) |
| `headers` | Record | N | | 모든 요청에 포함할 기본 HTTP 헤더 |
| `timeout` | number | N | 30000 | 요청 타임아웃 (밀리초) |

### 커맨드 설정

```yaml
commands:
  - id: users:create
    description: "사용자 생성"
    http:
      method: POST               # GET, POST, PUT, PATCH, DELETE
      path: "/users"             # baseUrl에 이어붙는 경로
      body:                      # 정적 body (flag와 병합됨)
        source: "cli"
```

### Flag 매핑 (httpMap)

플래그 값을 HTTP 요청의 어떤 부분으로 매핑할지 지정합니다:

#### Query Parameter (`httpMap: query`)

```yaml
flags:
  - name: status
    httpMap: query
    # -> GET /users?status=active

  - name: status
    httpMap: query
    httpName: "filter_status"
    # -> GET /users?filter_status=active (이름 변환)
```

#### Request Body (`httpMap: body`)

```yaml
flags:
  - name: name
    httpMap: body
    # -> POST /users  body: {"name": "John"}

  - name: name
    httpMap: body
    httpName: "user_name"
    # -> POST /users  body: {"user_name": "John"} (이름 변환)
```

#### Header (`httpMap: header`)

```yaml
flags:
  - name: trace-id
    httpMap: header
    # -> 요청 헤더에 추가: trace-id: <value>
```

### httpBodyType (Body 값 변환)

body로 매핑된 flag 값의 타입을 변환합니다:

```yaml
flags:
  # JSON 문자열 -> 객체
  - name: config
    httpMap: body
    httpBodyType: json
    # --config '{"key":"value"}' -> body: {"config": {"key": "value"}}

  # 콤마 구분 문자열 -> 문자열 배열
  - name: tags
    httpMap: body
    httpBodyType: array
    # --tags "a,b,c" -> body: {"tags": ["a", "b", "c"]}

  # 콤마 구분 문자열 -> 숫자 배열
  - name: ids
    httpMap: body
    httpBodyType: number-array
    # --ids "1,2,3" -> body: {"ids": [1, 2, 3]}
```

| httpBodyType | 변환 | 입력 예시 | 결과 |
|--------------|------|-----------|------|
| `json` | `JSON.parse()` | `'{"k":"v"}'` | `{"k":"v"}` |
| `array` | 콤마 split | `"a,b,c"` | `["a","b","c"]` |
| `number-array` | 콤마 split + Number | `"1,2,3"` | `[1,2,3]` |

### httpName (이름 변환)

CLI 플래그 이름과 실제 API 파라미터 이름이 다를 때 사용합니다:

```yaml
flags:
  - name: per-page        # CLI에서는 --per-page
    httpMap: query
    httpName: "per_page"   # API에서는 ?per_page=20
```

### Path Parameter

URL 경로에 동적 값을 삽입합니다. `args`로 정의한 값이 `{param}` 위치에 대체됩니다:

```yaml
commands:
  - id: users:get
    description: "사용자 상세 조회"
    http:
      method: GET
      path: "/users/{user_id}/posts/{post_id}"
    args:
      - name: user_id
        required: true
      - name: post_id
        required: true
```

```bash
my-cli api users get user-123 post-456
# -> GET https://api.example.com/v1/users/user-123/posts/post-456
```

Path parameter 값은 자동으로 `encodeURIComponent()`로 인코딩됩니다.

### 실행 순서

HTTP Provider는 다음 순서로 요청을 구성합니다:

1. Path parameter 치환 (`{param}` -> args 값)
2. Query parameter 구성 (`httpMap: query` 플래그)
3. Request body 구성 (정적 body + `httpMap: body` 플래그)
4. 헤더 구성 (`Content-Type` + provider headers + auth 헤더)
5. `fetch()` 실행
6. 응답 파싱 (JSON 또는 텍스트)

### Health Check

`doctor` 커맨드 실행 시 `baseUrl`에 GET 요청을 보내 연결 상태를 확인합니다 (5초 타임아웃).

---

## CLI Provider

외부 CLI 바이너리(kubectl, terraform, docker 등)를 래핑합니다. `child_process.spawn()`으로 실행합니다.

### Provider 설정

```yaml
provider:
  type: cli
  config:
    binary: kubectl              # 실행할 바이너리
    globalFlags: ["-o", "json"]  # 모든 커맨드에 붙는 글로벌 플래그
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `binary` | string | Y | | 실행할 바이너리 이름 또는 경로 |
| `globalFlags` | string[] | N | `[]` | 모든 커맨드에 자동 추가되는 플래그 |

### 커맨드 설정

```yaml
commands:
  - id: pods:list
    description: "Pod 목록 조회"
    cli:
      template: "get pods"       # binary 뒤에 붙는 서브커맨드
    outputParser: json            # 출력 파싱 방식
    overrideGlobalFlags: []       # globalFlags 비활성화 (빈 배열)
```

### cliTemplate

`template`은 바이너리 뒤에 붙는 기본 인자입니다. `{argName}` placeholder를 사용할 수 있습니다:

```yaml
commands:
  - id: pods:describe
    cli:
      template: "describe pod {name}"
    args:
      - name: name
        required: true
# -> kubectl describe pod my-pod -o json
```

### cliMap (Flag 매핑)

플래그 값을 CLI 인자로 변환합니다:

```yaml
flags:
  # 값이 있는 플래그: {value} placeholder 사용
  - name: namespace
    char: "n"
    cliMap: "-n {value}"
    # --namespace production -> -n production

  # Boolean 플래그: 그대로 추가
  - name: all-namespaces
    type: boolean
    cliMap: "--all-namespaces"
    # --all-namespaces -> --all-namespaces (값이 true일 때만)

  # 복합 매핑
  - name: selector
    cliMap: "-l {value}"
    # --selector "app=nginx" -> -l app=nginx
```

### outputParser (출력 파싱)

CLI 바이너리의 stdout을 파싱하는 방식을 지정합니다:

| outputParser | 동작 | 사용 사례 |
|--------------|------|-----------|
| `json` | `JSON.parse(stdout)` | kubectl -o json |
| `yaml` | YAML 파싱 | kubectl -o yaml |
| `line` | stdout을 그대로 단일 문자열로 반환 | 단일 값 출력 |
| `lines` | 줄바꿈으로 분리하여 문자열 배열로 반환 | 목록 출력 |
| `table` | 공백 구분 테이블 파싱 | `ps`, `df` 출력 |
| `csv` | 콤마 구분 테이블 파싱 | CSV 출력 |
| `regex` | 원본 문자열 그대로 반환 | 커스텀 후처리 |

### overrideGlobalFlags

특정 커맨드에서 globalFlags를 무시하거나 변경할 때 사용합니다:

```yaml
commands:
  - id: pods:list-yaml
    cli:
      template: "get pods"
    overrideGlobalFlags: ["-o", "yaml"]   # globalFlags 대신 이 값 사용

  - id: pods:version
    cli:
      template: "version"
    overrideGlobalFlags: []               # globalFlags 비활성화 (빈 배열)
```

`overrideGlobalFlags`가 설정되면 provider의 `globalFlags`를 대체합니다. 빈 배열이면 globalFlags가 적용되지 않습니다.

### CLI 인자 조립 순서

```
1. cliTemplate 확장: "get pods" -> ["get", "pods"]
   ({argName} placeholder -> args 값으로 치환)
2. cliMap 플래그 추가: ["-n", "production", "--all-namespaces"]
3. globalFlags 추가: ["-o", "json"]
   (overrideGlobalFlags가 있으면 대체)

최종: kubectl get pods -n production --all-namespaces -o json
```

### Health Check

`binary version` 또는 `binary --version`을 실행하여 바이너리 존재 여부를 확인합니다.

---

## Python Provider

Python 함수를 JSON-RPC over stdio 프로토콜로 호출합니다. Python SDK나 라이브러리를 CLI에서 직접 사용할 때 유용합니다.

### Provider 설정

```yaml
provider:
  type: python
  config:
    module: "my_sdk"             # Python 모듈 이름
    persistent: true             # 프로세스를 유지할지 여부
    idleTimeout: 300             # 유휴 타임아웃 (초, 기본 300)
    venv: "${MY_VENV_PATH}"     # virtualenv 경로 (선택)
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `module` | string | Y | | 호출할 Python 모듈 이름 |
| `persistent` | boolean | N | `false` | `true`: 프로세스 유지 (빠른 반복 호출). `false`: 매 호출마다 새 프로세스 |
| `idleTimeout` | number | N | 300 | persistent 모드에서 유휴 시 프로세스 종료 타임아웃 (초) |
| `venv` | string | N | | virtualenv 경로. 설정하면 해당 환경의 python3을 사용 |

### 커맨드 설정

```yaml
commands:
  - id: features:get
    description: "피처 조회"
    python:
      function: "get_feature"    # 호출할 Python 함수 이름
    flags:
      - name: entity-id
        required: true
        pythonName: "entity_id"  # CLI kebab-case -> Python snake_case
```

### pythonName (이름 변환)

CLI의 kebab-case 플래그 이름을 Python의 snake_case로 변환합니다:

```yaml
flags:
  - name: entity-id
    pythonName: "entity_id"
    # --entity-id "e-123" -> kwargs = {"entity_id": "e-123"}

  - name: max-count
    # pythonName 미지정 시 자동 변환: max-count -> max_count
```

`pythonName`을 지정하지 않으면 자동으로 하이픈(`-`)을 언더스코어(`_`)로 변환합니다.

### JSON-RPC Bridge

Python Provider는 JSON-RPC over stdio 프로토콜로 Python 프로세스와 통신합니다:

```
Node.js (PythonBridge)           Python (union_cli_bridge.py)
        |                                    |
        |-- stdin: JSON-RPC request -------->|
        |   {"jsonrpc":"2.0",               |
        |    "method":"call",               |
        |    "params":{                     |
        |      "function":"get_feature",    |
        |      "kwargs":{"entity_id":"123"},|
        |      "module":"my_sdk"            |
        |    }, "id":1}                     |
        |                                    |
        |<-- stdout: JSON-RPC response ------|
        |   {"jsonrpc":"2.0",               |
        |    "result":{...},                |
        |    "id":1}                        |
```

### persistent 모드

- `persistent: false` (기본): 매 호출마다 Python 프로세스를 생성하고 종료합니다. 호출 빈도가 낮을 때 적합합니다.
- `persistent: true`: 첫 호출 시 프로세스를 생성하고, 이후 호출에서 재사용합니다. `idleTimeout` 동안 호출이 없으면 자동 종료됩니다.

### virtualenv 지원

```yaml
venv: "/path/to/myenv"
```

설정 시:
- Python 경로: `/path/to/myenv/bin/python3`
- `VIRTUAL_ENV` 환경변수 설정
- `PATH`에 venv/bin을 우선 추가

### Health Check

설정된 Python 경로(또는 venv 내의 python3)에서 `python3 --version`을 실행하여 Python 존재 여부를 확인합니다.

---

## JS Provider

Node.js ESM/CJS 모듈을 in-process로 직접 호출합니다. 별도 프로세스 없이 같은 Node.js 프로세스에서 실행되므로 가장 빠릅니다.

### Provider 설정

```yaml
provider:
  type: js
  config:
    module: "./lib/sdk.js"       # 모듈 경로 또는 npm 패키지 이름
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `module` | string | Y | 모듈 파일 경로 또는 npm 패키지 이름 |

### 커맨드 설정

```yaml
commands:
  - id: data:export
    description: "데이터 내보내기"
    js:
      function: "exportData"     # 모듈에서 호출할 함수 이름
    flags:
      - name: format
        default: "json"
      - name: output-dir
        required: true
```

### ESM/CJS 호출

JS Provider는 먼저 ESM import를 시도하고, 실패하면 CJS require 방식으로 폴백합니다:

```javascript
// ESM 모듈
export async function exportData(args) {
  const { format, 'output-dir': outputDir } = args;
  // args와 flags가 하나의 객체로 병합되어 전달됩니다
  return { exported: 100, format, path: outputDir };
}
```

### 인자 전달

JS Provider는 `input.args`와 `input.flags`를 하나의 객체로 병합하여 함수에 전달합니다:

```yaml
args:
  - name: id
    required: true
flags:
  - name: verbose
    type: boolean
```

```bash
my-cli tools data export my-id --verbose
```

```javascript
// 함수에 전달되는 인자
exportData({
  id: "my-id",      // args에서
  verbose: true      // flags에서
})
```

### 모듈 캐싱

한번 로드된 모듈은 메모리에 캐싱됩니다. 동일한 모듈의 다른 함수를 호출할 때 다시 로드하지 않습니다.

### Health Check

모듈을 로드(`import()`)하여 정상적으로 로드되는지 확인합니다.

---

## Provider 선택 가이드

어떤 상황에서 어떤 Provider를 선택해야 하는지 가이드입니다:

| 상황 | 추천 Provider | 이유 |
|------|--------------|------|
| REST API 호출 | **HTTP** | 네이티브 fetch, 자동 인증, flag-to-query/body 매핑 |
| 외부 CLI 도구 래핑 (kubectl, terraform, aws) | **CLI** | 기존 CLI의 모든 기능을 그대로 활용, 출력 파싱 지원 |
| Python SDK/라이브러리 사용 | **Python** | JSON-RPC bridge로 Python 생태계 활용, venv 지원 |
| Node.js 모듈 직접 호출 | **JS** | in-process 호출로 가장 빠름, 타입 안전성 |
| 빠른 응답이 필요한 반복 호출 | **JS** 또는 **Python** (persistent) | 네트워크 오버헤드 없음 |
| 이미 잘 동작하는 CLI가 있는 경우 | **CLI** | 기존 도구를 그대로 래핑 |
| 여러 API를 하나로 통합 | **HTTP** (여러 manifest) | manifest별로 다른 baseUrl/auth 설정 가능 |

### 성능 비교

```
JS Provider      : ~1ms   (in-process, 가장 빠름)
Python persistent: ~10ms  (프로세스 재사용)
HTTP Provider    : ~50ms+ (네트워크 RTT 포함)
CLI Provider     : ~100ms+(프로세스 spawn + 실행)
Python one-shot  : ~500ms+(프로세스 spawn + Python 초기화)
```

### 여러 Provider 혼합 사용

하나의 CLI 프로젝트에서 여러 manifest를 통해 다양한 Provider를 동시에 사용할 수 있습니다:

```
plugins/
  api-service.yaml       # HTTP Provider  -> my-cli api ...
  k8s.yaml               # CLI Provider   -> my-cli k8s ...
  ml-features.yaml       # Python Provider -> my-cli ml ...
  data-tools.yaml        # JS Provider    -> my-cli data ...
```

각 manifest는 독립적인 namespace를 가지며, 서로 다른 Provider 타입을 사용할 수 있습니다.
