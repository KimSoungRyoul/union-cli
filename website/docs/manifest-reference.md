---
sidebar_position: 6
title: "Manifest Reference"
description: "union-cli YAML manifest의 전체 스키마 레퍼런스. 최상위 필드, Provider 설정, 커맨드 정의, 플래그 매핑 등을 상세히 설명합니다."
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Manifest Reference

이 문서는 union-cli YAML manifest의 **전체 스키마**를 설명합니다. manifest는 `plugins/` 디렉토리에 배치하며, `npm run build` 시 CLI 커맨드로 변환됩니다.

:::tip 아키텍처 먼저 이해하기
manifest가 빌드 파이프라인에서 어떻게 처리되는지 알고 싶다면 [Architecture](./architecture)를 먼저 읽어보세요.
:::

---

## 전체 스키마 구조

```yaml
# ── 최상위 필드 (필수) ──
name: <string>                    # 플러그인 이름
namespace: <string>               # CLI 네임스페이스 (커맨드 첫 단어)
description: <string>             # 플러그인 설명
provider:
  type: http | cli | python | js  # Provider 타입
  config: { ... }                 # Provider별 설정

# ── 커맨드 목록 (필수, 최소 1개) ──
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

### `name` **Required**

플러그인의 이름입니다. 식별 및 로깅 목적으로 사용됩니다.

```yaml
name: my-api-service
```

---

### `namespace` **Required**

CLI에서 커맨드의 **첫 번째 단어**로 사용되는 네임스페이스입니다. 소문자 시작, 소문자/숫자/하이픈만 허용됩니다 (`^[a-z][a-z0-9-]*$`).

```yaml
namespace: api
# → my-cli api users list
```

:::warning namespace 중복 불가
하나의 프로젝트에서 같은 namespace를 가진 manifest가 2개 이상이면 빌드 에러가 발생합니다.
:::

---

### `description` **Required**

플러그인의 설명입니다. `--help` 출력에 표시됩니다.

```yaml
description: "내 서비스의 REST API를 CLI로 사용"
```

---

## Provider 설정

### `provider.type` **Required**

| 값 | 설명 |
|----|------|
| `http` | REST API 호출 (fetch) |
| `cli` | 외부 CLI 바이너리 래핑 (spawn) |
| `python` | Python 함수 호출 (JSON-RPC) |
| `js` | Node.js 모듈 호출 (in-process) |

### `provider.config` **Required**

Provider 타입에 따라 다른 설정 객체를 사용합니다.

<Tabs>
<TabItem value="http" label="HTTP" default>

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"   # Required. 환경변수 치환 지원
    auth:                                    # Optional. 인증 설정
      type: bearer
      token:
        env: "API_TOKEN"
    headers:                                 # Optional. 기본 헤더
      X-Custom: "value"
    timeout: 30000                           # Optional. 타임아웃 (ms, 기본 30000)
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `baseUrl` **Required** | `string` | - | API 기본 URL. `${VAR:-default}` 환경변수 치환 지원 |
| `auth` | `object` | - | 인증 설정 ([Auth 가이드](./auth) 참고) |
| `headers` | `object` | - | 모든 요청에 추가할 기본 헤더 |
| `timeout` | `number` | `30000` | 요청 타임아웃 (밀리초) |

</TabItem>
<TabItem value="cli" label="CLI">

```yaml
provider:
  type: cli
  config:
    binary: kubectl                          # Required. 바이너리 이름/경로
    globalFlags: ["-o", "json"]              # Optional. 글로벌 플래그
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `binary` **Required** | `string` | - | 실행할 바이너리 이름 또는 절대 경로 |
| `globalFlags` | `string[]` | `[]` | 모든 커맨드에 적용할 글로벌 플래그 |

</TabItem>
<TabItem value="python" label="Python">

```yaml
provider:
  type: python
  config:
    module: "my_sdk"                         # Required. Python 모듈 이름
    persistent: true                         # Optional. 프로세스 유지 (기본 false)
    idleTimeout: 300                         # Optional. 유휴 타임아웃 초 (기본 300)
    venv: "${MY_VENV_PATH}"                  # Optional. virtualenv 경로
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `module` **Required** | `string` | - | import할 Python 모듈 이름 |
| `persistent` | `boolean` | `false` | Python 프로세스를 유지하여 반복 호출 성능 향상 |
| `idleTimeout` | `number` | `300` | 유휴 프로세스 종료까지 대기 시간 (초) |
| `venv` | `string` | - | virtualenv 경로. 환경변수 치환 지원 |

</TabItem>
<TabItem value="js" label="JS">

```yaml
provider:
  type: js
  config:
    module: "./lib/sdk.js"                   # Required. 모듈 경로 또는 패키지 이름
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `module` **Required** | `string` | - | ESM/CJS 모듈 경로 또는 npm 패키지 이름 |

</TabItem>
</Tabs>

---

## `commands` 섹션

커맨드 배열입니다. **최소 1개 이상** 필요합니다.

### `id` **Required**

커맨드의 고유 식별자입니다. `topic:action` 형태로 작성합니다 (`^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`).

```yaml
commands:
  - id: users:list       # → my-cli <namespace> users list
  - id: users:create     # → my-cli <namespace> users create
```

같은 manifest 내에서 중복 불가합니다.

:::info oclif에서의 변환
`id: users:list` + `namespace: api` 조합은 `my-cli api users list`로 변환됩니다 (topicSeparator가 공백일 때).
:::

### `description` **Required**

커맨드 설명입니다. `--help`에 표시됩니다.

---

### 커맨드별 Provider 설정

Provider 타입에 맞는 설정 섹션이 필요합니다. Provider 타입과 커맨드 설정이 일치하지 않으면 빌드 에러가 발생합니다.

<Tabs>
<TabItem value="http" label="HTTP" default>

```yaml
http:
  method: GET | POST | PUT | PATCH | DELETE
  path: "/users/{user_id}"      # Path parameter는 {name} 형식
  body:                          # Optional. 정적 body (flags와 병합)
    source: "cli"
```

| 필드 | 설명 |
|------|------|
| `method` **Required** | HTTP 메서드: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `path` **Required** | 엔드포인트 경로. `{name}` 형식으로 path parameter 지원 |
| `body` | 정적 body 값. flags의 `httpMap: body`와 병합됩니다 |

</TabItem>
<TabItem value="cli" label="CLI">

```yaml
cli:
  template: "get pods {name}"    # 바이너리 뒤 서브커맨드. {name} placeholder 지원
```

| 필드 | 설명 |
|------|------|
| `template` **Required** | 바이너리 뒤에 붙는 서브커맨드 템플릿. `{name}` placeholder로 args 참조 |

</TabItem>
<TabItem value="python" label="Python">

```yaml
python:
  function: "get_feature"        # 호출할 Python 함수 이름
```

| 필드 | 설명 |
|------|------|
| `function` **Required** | 호출할 Python 함수 이름 |

</TabItem>
<TabItem value="js" label="JS">

```yaml
js:
  function: "exportData"         # 호출할 JS 함수 이름
```

| 필드 | 설명 |
|------|------|
| `function` **Required** | 호출할 JS 함수 이름 (ESM export) |

</TabItem>
</Tabs>

---

## `args` (위치 인자)

커맨드에 전달하는 위치 기반 인자입니다. 순서대로 매핑됩니다.

```yaml
args:
  - name: user_id
    required: true
    description: "사용자 ID"
    default: "default-user"
```

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `name` **Required** | `string` | - | 인자 이름 |
| `required` | `boolean` | `false` | 필수 여부 |
| `description` | `string` | - | 인자 설명 |
| `default` | `any` | - | 기본값 |

**HTTP Provider에서 path parameter로 활용:**

```yaml
http:
  path: "/users/{user_id}"
args:
  - name: user_id
    required: true
```

---

## `flags` (옵션 플래그)

커맨드에 전달하는 이름 기반 옵션입니다.

### 기본 속성

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `name` **Required** | `string` | - | 플래그 이름 (`--name`으로 사용) |
| `type` | `string` | `string` | 값 타입: `string`, `number`, `boolean` |
| `char` | `string` | - | 단축키 (`-l` 등). 1자. `-h`와 `-q`는 사용 불가 |
| `required` | `boolean` | `false` | 필수 여부 |
| `default` | `any` | - | 기본값 |
| `description` | `string` | - | 플래그 설명 |
| `options` | `string[]` | - | 허용 값 목록 (enum) |

### Provider별 매핑 속성

<Tabs>
<TabItem value="http-flags" label="HTTP" default>

| 필드 | 설명 |
|------|------|
| `httpMap` | 매핑 대상: `query`, `body`, `header` |
| `httpName` | API 파라미터 이름이 플래그 이름과 다를 때 사용 |
| `httpBodyType` | body 값 변환: `json`, `array`, `number-array` |

**httpMap 요약:**

| httpMap | 동작 | 예시 |
|--------|------|------|
| `query` | `?name=value` | `--status active` → `?status=active` |
| `body` | JSON body field | `--name John` → `{"name":"John"}` |
| `header` | HTTP header | `--trace-id abc` → `trace-id: abc` |

`httpName`으로 플래그 이름과 API 파라미터 이름을 다르게 매핑할 수 있습니다:

```yaml
flags:
  - name: status
    httpMap: query
    httpName: "filter_status"   # → ?filter_status=active
```

자세한 매핑 예시와 `httpBodyType` 변환은 [Provider 가이드 - HTTP Provider](./providers#http-provider)를 참조하세요.

</TabItem>
<TabItem value="cli-flags" label="CLI">

| 필드 | 설명 |
|------|------|
| `cliMap` | CLI 인자 매핑 템플릿 |

```yaml
flags:
  - name: namespace
    char: "n"
    cliMap: "-n {value}"          # → -n production

  - name: all-namespaces
    type: boolean
    cliMap: "--all-namespaces"    # → --all-namespaces
```

</TabItem>
<TabItem value="python-flags" label="Python">

| 필드 | 설명 |
|------|------|
| `pythonName` | Python kwargs 키 이름. 미지정 시 하이픈을 언더스코어로 자동 변환 |

```yaml
flags:
  - name: entity-id
    pythonName: "entity_id"       # → entity_id=...
```

</TabItem>
</Tabs>

### Flag 타입별 동작

<Tabs>
<TabItem value="string-type" label="string (기본)" default>

```yaml
- name: status
  type: string          # 또는 type 생략 (기본값)
  default: "active"
  options: ["active", "inactive", "all"]
# → --status active
```

</TabItem>
<TabItem value="number-type" label="number">

```yaml
- name: limit
  type: number
  default: 20
# → --limit 50  (문자열을 숫자로 자동 파싱)
```

</TabItem>
<TabItem value="boolean-type" label="boolean">

```yaml
- name: verbose
  type: boolean
# → --verbose  (값 없이 플래그만 지정하면 true)
```

</TabItem>
</Tabs>

### 제약 사항

:::danger 예약된 플래그 이름
다음 이름은 표준 플래그와 충돌하므로 **사용할 수 없습니다**:
- `json`, `debug`, `quiet`, `no-color`, `format`, `help`

다음 단축키는 **사용할 수 없습니다**:
- `-h` (help), `-q` (quiet)
:::

:::warning 민감 정보 경고
다음 이름 패턴은 빌드 시 **경고**가 출력됩니다 (ps/history 노출 위험):
- `password`, `secret`, `token`, `api-key`, `api_key`, `credential`, `auth-token`, `auth_token`

민감 정보는 [SecretRef](./auth#secretref---비밀값-참조)를 사용하여 환경변수나 파일에서 읽어오세요.
:::

---

## `examples`

사용 예시 목록입니다. `--help`에 표시됩니다.

```yaml
examples:
  - "my-cli api users list --limit 50"
  - "my-cli api users list --status active --json"
```

---

## `outputParser` (CLI Provider 전용)

CLI 바이너리의 stdout 출력을 파싱하는 방식입니다. **CLI Provider에서만 사용**됩니다.

| 값 | 동작 |
|----|------|
| `json` | `JSON.parse` (기본값) |
| `yaml` | YAML 파싱 |
| `line` | 단일 문자열 |
| `lines` | 줄바꿈 분리 → 문자열 배열 |
| `table` | 공백 구분 테이블 파싱 |
| `csv` | 콤마 구분 테이블 파싱 |
| `regex` | 원본 그대로 반환 |

---

## `overrideGlobalFlags` (CLI Provider 전용)

특정 커맨드에서 provider의 `globalFlags`를 대체합니다.

```yaml
# globalFlags를 ["-o", "yaml"]로 대체
overrideGlobalFlags: ["-o", "yaml"]

# globalFlags 비활성화
overrideGlobalFlags: []
```

:::info
`overrideGlobalFlags`를 빈 배열(`[]`)로 설정하면 해당 커맨드에서 globalFlags가 완전히 비활성화됩니다. 이는 로그 출력처럼 JSON 형식이 필요 없는 커맨드에 유용합니다.
:::

---

## `dangerous`

위험한 동작(삭제, 초기화 등)을 수행하는 커맨드에 설정합니다.

```yaml
commands:
  - id: data:reset
    description: "전체 데이터 초기화"
    dangerous: true
    http:
      method: DELETE
      path: "/data"
```

`dangerous: true` 설정 시:
- 실행 전 `정말 실행하시겠습니까? (y/N):` 확인 프롬프트 표시
- `--force` 플래그 자동 추가 (확인 건너뛰기)
- 비-TTY 환경에서는 `--force` 없이 실행 불가 (CI/CD 안전장치)

---

## `successMessage`

커맨드 성공 시 표시할 사용자 정의 메시지입니다. `{argName}` 또는 `{flagName}`으로 값을 삽입할 수 있습니다.

```yaml
successMessage: "사용자 {name}이(가) 성공적으로 생성되었습니다."
```

stderr로 출력되어 파이프 오염을 방지합니다. `--quiet` 시 표시되지 않습니다. 미설정 시 GET이 아닌 HTTP method에서 `"POST 요청 완료 (123ms)"` 형태의 기본 메시지가 표시됩니다.

---

## 인증 (Auth)

### 지원 타입

| 타입 | 설정 | 동작 |
|------|------|------|
| `none` | `type: none` | 인증 없이 요청 |
| `bearer` | `type: bearer` + `token` | `Authorization: Bearer {token}` |
| `basic` | `type: basic` + `credentials` | `Authorization: Basic {base64}` |
| `jwt` | `type: jwt` + `tokenEndpoint` + `credentials` | 자동 토큰 발급 + TTL 캐싱 |
| `api-key` | `type: api-key` + `token` + `headerName` | `{headerName}: {token}` |
| `cookie` | `type: cookie` + `serviceName` | OAuth 브라우저 로그인 → 쿠키 저장 |

### SecretRef (비밀값 참조)

토큰, 비밀번호 등은 직접 YAML에 넣지 않고 참조로 선언합니다. 4가지 소스(env, file, command, value)를 지원합니다.

자세한 설명과 예시는 [인증 가이드 -- SecretRef](./auth#secretref---비밀값-참조)를 참조하세요.

### Auth 타입별 설정

<Tabs>
<TabItem value="bearer" label="Bearer" default>

```yaml
auth:
  type: bearer
  token:
    env: "API_TOKEN"
```

</TabItem>
<TabItem value="basic" label="Basic">

```yaml
auth:
  type: basic
  credentials:
    username:
      env: "API_USER"
    password:
      env: "API_PASS"
```

</TabItem>
<TabItem value="jwt" label="JWT">

```yaml
auth:
  type: jwt
  tokenEndpoint: "/auth/token"   # baseUrl + tokenEndpoint에 POST
  tokenTTL: 1800                 # 캐싱 TTL (초, 기본 1800)
  credentials:
    username:
      env: "JWT_USER"
    password:
      env: "JWT_PASS"
```

</TabItem>
<TabItem value="api-key" label="API Key">

```yaml
auth:
  type: api-key
  token:
    env: "API_KEY"
  headerName: "X-API-Key"       # 기본값: X-API-Key
```

</TabItem>
<TabItem value="cookie" label="Cookie">

```yaml
auth:
  type: cookie
  serviceName: "my-service"     # .union-cli/tokens.json의 키
```

</TabItem>
</Tabs>

각 인증 타입의 동작 방식과 상세 설정은 [인증 가이드](./auth)를 참조하세요.

---

## 환경변수 치환

manifest의 문자열 값에서 환경변수를 참조할 수 있습니다.

| 문법 | 설명 |
|------|------|
| `${VAR_NAME}` | 환경변수 값으로 치환. 없으면 빈 문자열 |
| `${VAR_NAME:-default}` | 환경변수가 없으면 기본값 사용 |

```yaml
baseUrl: "${BASE_URL:-https://default.example.com}/api/v1"
```

환경변수 치환은 `provider.config.baseUrl` (init hook 및 codegen에서 해석)과 SecretRef의 `env` 필드 (런타임에 `process.env`에서 읽기)에서 수행됩니다.

:::tip
환경변수 치환이 아키텍처에서 어떻게 동작하는지에 대한 자세한 내용은 [Architecture - 환경변수 치환](./architecture#환경변수-치환)을 참고하세요.
:::

---

## 전체 예시

### HTTP Provider 전체 예시

다음은 인증, 다양한 플래그 매핑, dangerous 커맨드를 포함한 **완전한 HTTP Provider manifest**입니다.

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
  # ── 조회: GET + query parameters ──
  - id: users:list
    description: "사용자 목록 조회"
    http: { method: GET, path: "/users" }
    flags:
      - name: limit
        type: number
        default: 20
        httpMap: query
      - name: status
        options: ["active", "inactive"]
        httpMap: query

  # ── 상세 조회: GET + path parameter ──
  - id: users:get
    description: "사용자 상세 조회"
    http: { method: GET, path: "/users/{user_id}" }
    args:
      - name: user_id
        required: true

  # ── 생성: POST + body mapping + successMessage ──
  - id: users:create
    description: "사용자 생성"
    http: { method: POST, path: "/users" }
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

  # ── 삭제: DELETE + dangerous ──
  - id: users:delete
    description: "사용자 삭제"
    dangerous: true
    http: { method: DELETE, path: "/users/{user_id}" }
    args:
      - name: user_id
        required: true
```

CLI Provider 전체 예시는 [Provider 가이드 - CLI Provider](./providers#cli-provider)를 참조하세요.
