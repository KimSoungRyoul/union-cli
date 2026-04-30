# Manifest Reference - YAML 전체 레퍼런스

이 문서는 union-cli YAML manifest의 전체 스키마를 설명합니다.

---

## 전체 스키마 구조

```yaml
# 필수 필드
name: <string>                    # 플러그인 이름
namespace: <string>               # CLI 네임스페이스 (커맨드 첫 단어)
description: <string>             # 플러그인 설명
provider:
  type: http | cli | python | js  # Provider 타입
  config: { ... }                 # Provider별 설정
commands:
  - id: <topic>:<action>          # 커맨드 ID
    description: <string>         # 커맨드 설명
    http: { ... }                 # HTTP Provider 커맨드 설정
    cli: { ... }                  # CLI Provider 커맨드 설정
    python: { ... }               # Python Provider 커맨드 설정
    js: { ... }                   # JS Provider 커맨드 설정
    args: [ ... ]                 # 위치 인자
    flags: [ ... ]                # 옵션 플래그
    examples: [ ... ]             # 사용 예시
    outputParser: <string>        # CLI Provider 출력 파서
    overrideGlobalFlags: [ ... ]  # CLI Provider globalFlags 대체
    dangerous: <boolean>          # 위험 동작 표시
    successMessage: <string>      # 성공 메시지 템플릿
```

---

## 최상위 필드

### name (필수)

플러그인의 이름입니다. 식별 및 로깅 목적으로 사용됩니다.

```yaml
name: my-api-service
```

- 타입: `string`
- 제약: 1자 이상

### namespace (필수)

CLI에서 커맨드의 첫 번째 단어로 사용되는 네임스페이스입니다.

```yaml
namespace: api
# -> my-cli api users list
```

- 타입: `string`
- 패턴: `^[a-z][a-z0-9-]*$` (소문자 시작, 소문자/숫자/하이픈만 허용)
- 중복 불가: 하나의 프로젝트에서 같은 namespace를 가진 manifest가 2개 이상이면 빌드 에러

### description (필수)

플러그인의 설명입니다. `--help` 출력에 표시됩니다.

```yaml
description: "내 서비스의 REST API를 CLI로 사용"
```

---

## provider 섹션

### provider.type (필수)

Provider 타입을 지정합니다.

| 값 | 설명 |
|----|------|
| `http` | REST API 호출 (fetch) |
| `cli` | 외부 CLI 바이너리 래핑 (spawn) |
| `python` | Python 함수 호출 (JSON-RPC) |
| `js` | Node.js 모듈 호출 (in-process) |

### provider.config (필수)

Provider 타입에 따라 다른 설정 객체를 사용합니다.

#### HTTP Provider Config

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"   # 필수. 환경변수 치환 지원
    auth:                                    # 선택. 인증 설정
      type: bearer
      token:
        env: "API_TOKEN"
    headers:                                 # 선택. 기본 헤더
      X-Custom: "value"
    timeout: 30000                           # 선택. 타임아웃 (ms, 기본 30000)
    credentialStore: file                    # 선택. file | keychain | env (기본 file)
    retry:                                   # 선택. 재시도 정책 (기본 attempts: 1 = no retry)
      attempts: 3
      initialDelayMs: 200                    # exponential backoff 의 base
      maxDelayMs: 5000                       # 재시도 delay 상한 (Retry-After 에도 적용)
      retryOn: [429, 500, 502, 503, 504]     # 재시도 대상 status code
      respectRetryAfter: true                # Retry-After 헤더 우선
      jitter: full                           # full | equal | none
      idempotent: auto                       # auto = GET/HEAD/PUT/DELETE 만 retry, true | false
```

**Retry 동작**:
- 응답 status 가 `retryOn` 에 포함되거나 fetch 자체가 실패 (네트워크 에러 / AbortError) 한 경우 재시도.
- `idempotent: auto` (기본) 면 GET/HEAD/PUT/DELETE 만 재시도. POST/PATCH 는 명시적으로 `idempotent: true` 로만 활성화.
- delay 계산: `min(maxDelayMs, initialDelayMs * 2^(attempt-1))` 에 jitter 적용. `Retry-After` 가 있으면 우선.
- 401 은 retry 정책 미적용 (`auth-handlers` 의 JWT refresh 가 처리).

**credentialStore 옵션**:
- `file` (기본): `~/.<cli-name>/credentials/<ns>.json`, `chmod 0600`.
- `keychain`: macOS Keychain (`security`) / Linux libsecret (`secret-tool`) / Windows Credential Manager (`cmdkey` + sidecar). OS CLI 미설치 시 `file` 로 graceful fallback.
- `env`: `<CLI_UPPER>_<NS_UPPER>_TOKEN` 환경변수 (read-only, set/delete 시 throw). CI/CD 환경 권장.

#### CLI Provider Config

```yaml
provider:
  type: cli
  config:
    binary: kubectl                          # 필수. 바이너리 이름/경로
    globalFlags: ["-o", "json"]              # 선택. 글로벌 플래그
```

#### Python Provider Config

```yaml
provider:
  type: python
  config:
    module: "my_sdk"                         # 필수. Python 모듈 이름
    persistent: true                         # 선택. 프로세스 유지 (기본 false)
    idleTimeout: 300                         # 선택. 유휴 타임아웃 초 (기본 300)
    venv: "${MY_VENV_PATH}"                 # 선택. virtualenv 경로
```

#### JS Provider Config

```yaml
provider:
  type: js
  config:
    module: "./lib/sdk.js"                   # 필수. 모듈 경로 또는 패키지 이름
```

---

## commands 섹션

커맨드 배열입니다. 최소 1개 이상 필요합니다.

### id (필수)

커맨드의 고유 식별자입니다. `topic:action` 형태로 작성합니다.

```yaml
commands:
  - id: users:list       # -> my-cli <namespace> users list
  - id: users:create     # -> my-cli <namespace> users create
  - id: pods:describe    # -> my-cli <namespace> pods describe
```

- 패턴: `^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`
- 소문자 시작, 소문자/숫자/하이픈 허용
- 콜론(`:`) 앞이 topic, 뒤가 action
- 같은 manifest 내에서 중복 불가

oclif에서의 변환: `id: users:list` + `namespace: api` -> `my-cli api users list` (topicSeparator가 공백일 때)

### description (필수)

커맨드 설명입니다. `--help`에 표시됩니다.

```yaml
  - id: users:list
    description: "전체 사용자 목록을 조회합니다"
```

### 커맨드별 Provider 설정

Provider 타입에 맞는 설정 섹션이 필요합니다. Provider 타입과 커맨드 설정이 일치하지 않으면 빌드 에러가 발생합니다.

#### http (HTTP Provider)

```yaml
http:
  method: GET | POST | PUT | PATCH | DELETE
  path: "/users/{user_id}"      # Path parameter는 {name} 형식
  body:                          # 선택. 정적 body (flags와 병합)
    source: "cli"
```

#### cli (CLI Provider)

```yaml
cli:
  template: "get pods {name}"    # 바이너리 뒤 서브커맨드. {name} placeholder 지원
```

#### python (Python Provider)

```yaml
python:
  function: "get_feature"        # 호출할 Python 함수 이름
```

#### js (JS Provider)

```yaml
js:
  function: "exportData"         # 호출할 JS 함수 이름
```

---

## args (위치 인자)

커맨드에 전달하는 위치 기반 인자입니다. 순서대로 매핑됩니다.

```yaml
args:
  - name: user_id
    required: true
    description: "사용자 ID"
    default: "default-user"
```

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `name` | string | Y | | 인자 이름 |
| `required` | boolean | N | `false` | 필수 여부 |
| `description` | string | N | | 인자 설명 |
| `default` | any | N | | 기본값 |

사용 예:

```bash
my-cli api users get user-123
#                    ^^^^^^^^ user_id 인자
```

HTTP Provider에서 path parameter로 활용:
```yaml
http:
  path: "/users/{user_id}"
args:
  - name: user_id
    required: true
```

---

## flags (옵션 플래그)

커맨드에 전달하는 이름 기반 옵션입니다.

```yaml
flags:
  - name: limit
    type: number
    default: 20
    description: "조회 개수"
    char: "l"
    required: false
    options: null
    httpMap: query
    httpName: null
    httpBodyType: null
    cliMap: null
    pythonName: null
```

### 기본 속성

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `name` | string | Y | | 플래그 이름 (`--name`으로 사용) |
| `type` | string | N | `string` | 값 타입: `string`, `number`, `boolean` |
| `char` | string | N | | 단축키 (`-l` 등). 1자. `-h`와 `-q`는 사용 불가 |
| `required` | boolean | N | `false` | 필수 여부 |
| `default` | any | N | | 기본값 |
| `description` | string | N | | 플래그 설명 |
| `options` | string[] | N | | 허용 값 목록 (enum) |

### Provider별 속성

#### HTTP Provider

| 필드 | 설명 |
|------|------|
| `httpMap` | 매핑 대상: `query`, `body`, `header` |
| `httpName` | API 파라미터 이름이 플래그 이름과 다를 때 사용 |
| `httpBodyType` | body 값 변환: `json`, `array`, `number-array` |

#### CLI Provider

| 필드 | 설명 |
|------|------|
| `cliMap` | CLI 인자 매핑 템플릿. 예: `"-n {value}"`, `"--all-namespaces"` |

#### Python Provider

| 필드 | 설명 |
|------|------|
| `pythonName` | Python kwargs 키 이름. 미지정 시 하이픈을 언더스코어로 자동 변환 |

### Flag 타입별 동작

#### string (기본)

```yaml
- name: status
  type: string          # 또는 type 생략 (기본값)
  default: "active"
  options: ["active", "inactive", "all"]
# -> --status active
```

#### number

```yaml
- name: limit
  type: number
  default: 20
# -> --limit 50  (문자열을 숫자로 자동 파싱)
```

#### boolean

```yaml
- name: verbose
  type: boolean
# -> --verbose  (값 없이 플래그만 지정하면 true)
```

### 제약 사항

다음 이름은 표준 플래그와 충돌하므로 사용할 수 없습니다:

- `json`, `debug`, `quiet`, `no-color`, `format`, `help`

다음 단축키는 사용할 수 없습니다:

- `-h` (help), `-q` (quiet)

다음 이름 패턴은 민감 정보 경고가 출력됩니다:

- `password`, `secret`, `token`, `api-key`, `api_key`, `credential`, `auth-token`, `auth_token`

---

## examples

사용 예시 목록입니다. `--help`에 표시됩니다.

```yaml
examples:
  - "my-cli api users list --limit 50"
  - "my-cli api users list --status active --json"
  - "my-cli api users list --format csv > users.csv"
```

---

## outputParser (CLI Provider 전용)

CLI 바이너리의 stdout 출력을 파싱하는 방식입니다. CLI Provider에서만 사용됩니다.

```yaml
commands:
  - id: pods:list
    cli:
      template: "get pods"
    outputParser: json
```

| 값 | 동작 |
|----|------|
| `json` | JSON.parse (기본값) |
| `yaml` | YAML 파싱 |
| `line` | 단일 문자열 |
| `lines` | 줄바꿈 분리 -> 문자열 배열 |
| `table` | 공백 구분 테이블 파싱 |
| `csv` | 콤마 구분 테이블 파싱 |
| `regex` | 원본 그대로 반환 |

---

## overrideGlobalFlags (CLI Provider 전용)

특정 커맨드에서 provider의 `globalFlags`를 대체합니다.

```yaml
# globalFlags를 ["-o", "yaml"]로 대체
overrideGlobalFlags: ["-o", "yaml"]

# globalFlags 비활성화
overrideGlobalFlags: []
```

---

## dangerous

위험한 동작(삭제, 초기화 등)을 수행하는 커맨드에 설정합니다. `true`로 설정하면:

1. 실행 전 확인 프롬프트가 표시됩니다: `정말 실행하시겠습니까? (y/N):`
2. `--force` 플래그가 자동으로 추가됩니다 (확인 건너뛰기)
3. 비-TTY 환경에서는 `--force` 없이 실행할 수 없습니다

```yaml
commands:
  - id: data:reset
    description: "전체 데이터 초기화"
    dangerous: true
    http:
      method: DELETE
      path: "/data"
```

```bash
# 확인 프롬프트 표시
my-cli api data reset
# 정말 실행하시겠습니까? (y/N): y

# 확인 없이 실행
my-cli api data reset --force

# CI/CD 환경 (비-TTY)
my-cli api data reset --force
```

---

## successMessage

커맨드 성공 시 표시할 사용자 정의 메시지입니다. stderr로 출력되어 파이프 오염을 방지합니다.

```yaml
commands:
  - id: users:create
    description: "사용자 생성"
    successMessage: "사용자 {name}이(가) 성공적으로 생성되었습니다."
    http:
      method: POST
      path: "/users"
    flags:
      - name: name
        required: true
        httpMap: body
```

- `{argName}` 또는 `{flagName}` placeholder를 사용하여 인자/플래그 값을 삽입할 수 있습니다.
- `--quiet` 플래그가 설정되면 표시되지 않습니다.
- `successMessage`가 없고 HTTP method가 GET이 아닌 경우, 기본으로 `"POST 요청 완료 (123ms)"` 형태의 메시지가 표시됩니다.

---

## 환경변수 치환

manifest의 문자열 값에서 환경변수를 참조할 수 있습니다.

### 문법

```yaml
# 환경변수 참조
baseUrl: "${BASE_URL}"

# 환경변수 + 기본값
baseUrl: "${BASE_URL:-https://default.example.com}/api/v1"
```

- `${VAR_NAME}`: 환경변수 값으로 치환. 없으면 빈 문자열
- `${VAR_NAME:-default}`: 환경변수가 없으면 기본값 사용

### 적용 범위

환경변수 치환은 다음 위치에서 수행됩니다:

- `provider.config.baseUrl` (init hook 및 codegen에서 해석)
- SecretRef의 `env` 필드 (런타임에 `process.env`에서 읽기)

---

## 전체 예시

### HTTP Provider 전체 예시

```yaml
name: my-service
namespace: svc
description: "내 서비스 API"

provider:
  type: http
  config:
    baseUrl: "${SVC_URL:-https://api.example.com}/v1"
    auth:
      type: jwt
      tokenEndpoint: "/auth/token"
      tokenTTL: 1800
      credentials:
        username:
          env: "SVC_USER"
        password:
          env: "SVC_PASS"
    headers:
      X-Client: "union-cli"
    timeout: 15000

commands:
  - id: users:list
    description: "사용자 목록 조회"
    http:
      method: GET
      path: "/users"
    flags:
      - name: limit
        type: number
        default: 20
        httpMap: query
      - name: offset
        type: number
        default: 0
        httpMap: query
      - name: status
        options: ["active", "inactive"]
        httpMap: query
    examples:
      - "my-cli svc users list --limit 50 --status active --json"

  - id: users:get
    description: "사용자 상세 조회"
    http:
      method: GET
      path: "/users/{user_id}"
    args:
      - name: user_id
        required: true
        description: "사용자 ID"

  - id: users:create
    description: "사용자 생성"
    http:
      method: POST
      path: "/users"
    successMessage: "사용자 {name}이(가) 생성되었습니다."
    flags:
      - name: name
        required: true
        httpMap: body
      - name: email
        required: true
        httpMap: body
      - name: roles
        httpMap: body
        httpBodyType: array
        description: "역할 목록 (콤마 구분)"

  - id: users:delete
    description: "사용자 삭제"
    dangerous: true
    http:
      method: DELETE
      path: "/users/{user_id}"
    args:
      - name: user_id
        required: true
```

### CLI Provider 전체 예시

```yaml
name: k8s-tools
namespace: k8s
description: "Kubernetes 관리 도구"

provider:
  type: cli
  config:
    binary: kubectl
    globalFlags: ["-o", "json"]

commands:
  - id: pods:list
    description: "Pod 목록"
    cli:
      template: "get pods"
    flags:
      - name: namespace
        char: "n"
        cliMap: "-n {value}"
      - name: all-namespaces
        type: boolean
        cliMap: "--all-namespaces"
      - name: selector
        char: "l"
        cliMap: "-l {value}"
    outputParser: json

  - id: pods:logs
    description: "Pod 로그"
    cli:
      template: "logs {name}"
    args:
      - name: name
        required: true
    flags:
      - name: follow
        type: boolean
        char: "f"
        cliMap: "-f"
      - name: tail
        type: number
        cliMap: "--tail {value}"
    outputParser: line
    overrideGlobalFlags: []
```
