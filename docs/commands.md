# Commands - Built-in 커맨드 가이드

union-cli는 빌드 시 자동 생성되는 Built-in 커맨드와 프레임워크 관리용 커맨드를 제공합니다.

---

## 자동 생성 커맨드 (Codegen)

`npm run build` 시 manifest에서 정의한 커맨드와 함께 다음 Built-in 커맨드가 자동 생성됩니다:

- `auth/login.js` - 인증 로그인
- `auth/status.js` - 인증 상태 조회
- `auth/logout.js` - 인증 로그아웃
- `doctor.js` - 시스템 진단

이 커맨드들은 manifest 정보(namespace, auth 설정, baseUrl 등)가 코드에 임베딩되어 생성됩니다.

---

## auth - 인증 관리

### auth login

Provider별 인증 로그인을 수행합니다.

```bash
# 모든 provider에 대해 순차 로그인
my-cli auth login

# 특정 namespace만 로그인
my-cli auth login <namespace>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `namespace` | N | 로그인할 Provider의 namespace. 생략 시 모든 provider |

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--json` | 결과를 JSON으로 출력 |
| `--no-color` | 색상/이모지 비활성화 |

**auth type별 동작:**

- `none`: 건너뜀 ("인증 불필요")
- `cookie`: 브라우저 OAuth 로그인 -> Chrome 쿠키 추출 -> `.union-cli/tokens.json` 저장
- `bearer` / `api-key`: 토큰 직접 입력 프롬프트 -> tokens.json 저장
- 기타: "미지원" 경고

**예시:**

```bash
$ my-cli auth login

🔐 api (cookie) 로그인...
  브라우저에서 로그인하세요...
  로그인 완료 후 Enter를 누르세요:
  ✅ api: 2개 쿠키 저장 완료

🔐 public (none) 로그인...
  ℹ public: 인증 불필요
```

### auth logout

인증 정보를 삭제합니다.

```bash
# 전체 로그아웃 (tokens.json 파일 삭제)
my-cli auth logout

# 특정 namespace만 로그아웃
my-cli auth logout <namespace>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `namespace` | N | 로그아웃할 namespace. 생략 시 전체 로그아웃 |

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--json` | 결과를 JSON으로 출력 |
| `--no-color` | 색상/이모지 비활성화 |

### auth status

현재 인증 상태를 테이블로 표시합니다.

```bash
my-cli auth status
my-cli auth status --verify
my-cli auth status --json
```

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--json` | 결과를 JSON으로 출력 |
| `--verify` | 실제 API 호출(`/api/v1/auth/me`)로 토큰 유효성 확인 |
| `--no-color` | 색상/이모지 비활성화 |

**출력 예시:**

```
NAMESPACE   AUTH TYPE  STATUS      EXPIRES
---------   ---------  ----------  -------------------
api         cookie     ✓ valid     2026-04-07 09:18:50
k8s-proxy   cookie     ✗ expired   2026-04-07 08:32:50
public      none       ✓ (no auth)
```

`--json` 출력:

```json
[
  {
    "namespace": "api",
    "auth_type": "cookie",
    "status": "✓ valid",
    "expires": "2026-04-07 09:18:50"
  }
]
```

### auth token

특정 namespace의 토큰을 stdout으로 출력합니다. 파이프나 다른 도구와 연동할 때 사용합니다.

```bash
my-cli auth token <namespace>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `namespace` | Y | 토큰을 출력할 Provider namespace |

**사용 예시:**

```bash
# 토큰 출력
my-cli auth token api

# 다른 도구에 토큰 전달
curl -H "Authorization: Bearer $(my-cli auth token api)" https://api.example.com/v1/me
```

---

## config - 설정 관리

CLI 설정을 관리합니다. 설정은 `~/.my-cli/config.yaml`에 YAML 형식으로 저장됩니다.

### config get

설정값을 조회합니다.

```bash
my-cli config get <key>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `key` | Y | 조회할 설정 키 |

**예시:**

```bash
$ my-cli config get default_format
json

$ my-cli config get nonexistent_key
(nonexistent_key 설정되지 않음)
```

### config set

설정값을 저장합니다.

```bash
my-cli config set <key> <value>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `key` | Y | 설정 키 |
| `value` | Y | 설정 값 |

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--global` | 글로벌 설정에 저장 |

**예시:**

```bash
$ my-cli config set default_format json
✓ default_format = json
```

### config list

전체 설정을 출력합니다.

```bash
my-cli config list
my-cli config list --json
```

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--json` | JSON 형식으로 출력 |
| `--global` | 글로벌 설정 조회 |

**예시:**

```bash
$ my-cli config list
default_format = json
timeout = 30000

$ my-cli config list --json
{
  "default_format": "json",
  "timeout": "30000"
}
```

### config reset

설정을 초기화합니다.

```bash
# 특정 키 초기화
my-cli config reset <key>

# 전체 설정 초기화
my-cli config reset
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `key` | N | 초기화할 설정 키. 생략 시 전체 초기화 |

---

## plugin - 플러그인 관리

외부 플러그인을 관리합니다.

### plugin add

플러그인을 추가합니다.

```bash
my-cli plugin add <source>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `source` | Y | 플러그인 경로 또는 npm 패키지 이름 |

**예시:**

```bash
my-cli plugin add ./plugins/custom-api.yaml
my-cli plugin add @my-org/cli-plugin-monitoring
```

### plugin remove

플러그인을 제거합니다.

```bash
my-cli plugin remove <name>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `name` | Y | 제거할 플러그인 이름 |

### plugin list

등록된 플러그인 목록을 출력합니다.

```bash
my-cli plugin list
my-cli plugin list --json
```

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--json` | JSON 형식으로 출력 |

---

## completion - 자동완성

### completion install

셸 자동완성을 설치합니다.

```bash
my-cli completion install [shell]
```

**인자:**

| 인자 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `shell` | N | `zsh` | 셸 종류: `bash`, `zsh`, `fish` |

**예시:**

```bash
my-cli completion install zsh
my-cli completion install bash
```

---

## doctor - 시스템 진단

Node.js, manifest, Provider 상태를 종합적으로 확인합니다.

```bash
my-cli doctor
my-cli doctor --json
```

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--json` | JSON 형식으로 출력 |
| `--no-color` | 색상/이모지 비활성화 |

**출력 예시:**

```bash
$ my-cli doctor
시스템 상태:
  Node.js: v20.10.0 ✓
  작업 디렉토리: /path/to/my-cli ✓
  매니페스트: 3개 ✓
  토큰: ✓

Provider 상태:
  api: ✓ ok
  k8s: ✗ unreachable
  public: ✓ ok
```

**점검 항목:**

| 항목 | 설명 |
|------|------|
| Node.js | Node.js 버전 확인 |
| 작업 디렉토리 | 현재 작업 디렉토리 |
| 매니페스트 | `.union-cli/manifest.json` 존재 여부 + manifest 개수 |
| 토큰 | `.union-cli/tokens.json` 존재 여부 |
| Provider 상태 | 각 Provider의 health endpoint(`/health`)에 GET 요청 (5초 타임아웃) |

**`--json` 출력:**

```json
{
  "node": { "status": "ok", "version": "v20.10.0" },
  "cwd": { "status": "ok", "path": "/path/to/my-cli" },
  "manifests": { "status": "ok", "count": 3 },
  "tokens": { "status": "ok" },
  "providers": [
    { "namespace": "api", "status": "ok", "code": 200 },
    { "namespace": "k8s", "status": "unreachable", "error": "fetch failed" }
  ]
}
```

---

## build - YAML Manifest 빌드

YAML manifest를 파싱하고 oclif 커맨드 파일을 생성합니다.

```bash
my-cli build
my-cli build --codegen
```

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--codegen` | TypeScript 코드 생성 모드 |
| `--watch` | 파일 변경 감지 모드 |

**빌드 과정:**

1. manifest 파일 탐색 (`plugins/*.yaml`, `.union-cli/plugins/*.yaml`)
2. YAML 파싱 + 스키마 검증 + 의미 검증
3. `.union-cli/manifest.json`에 캐시 저장
4. `--codegen` 시 `dist/commands/`에 JS 파일 생성

**예시:**

```bash
$ my-cli build
Building...
3개 manifest에서 빌드 완료
  캐시: .union-cli/manifest.json
  명령: 24개
```

---

## codegen - 코드 생성

특정 플러그인의 TypeScript 코드를 생성합니다.

```bash
my-cli codegen <plugin>
```

**인자:**

| 인자 | 필수 | 설명 |
|------|------|------|
| `plugin` | Y | 플러그인 이름 |

---

## init - 프로젝트 초기화

union-cli 프로젝트를 초기화합니다. `.union-cli/` 및 `plugins/` 디렉토리를 생성합니다.

```bash
my-cli init
my-cli init --force
```

**플래그:**

| 플래그 | 단축키 | 설명 |
|--------|--------|------|
| `--force` | `-f` | 기존 설정이 있어도 덮어쓰기 |

**예시:**

```bash
$ my-cli init
✓ 프로젝트 초기화 완료
다음 단계:
  1. plugins/ 디렉토리에 YAML manifest를 작성하세요
  2. my-cli build
```

---

## 출력 형식 (Global Flags)

모든 커맨드에 자동으로 적용되는 표준 플래그입니다.

### --json

JSON 형식으로 출력합니다. `--format json`의 단축 형태입니다.

```bash
my-cli api users list --json
```

```json
{
  "data": [
    { "id": 1, "name": "John", "email": "john@example.com" }
  ]
}
```

### --format

출력 형식을 지정합니다.

| 값 | 설명 | 예시 |
|----|------|------|
| `table` | 테이블 형식 (기본) | 열 정렬된 텍스트 테이블 |
| `json` | JSON | `--json`과 동일 |
| `yaml` | YAML | YAML 형식 출력 |
| `csv` | CSV | 콤마 구분, 첫 줄 헤더 |

```bash
# 테이블 (기본)
my-cli api users list
# NAME    EMAIL             STATUS
# ------  ----------------  ------
# John    john@example.com  active
# Jane    jane@example.com  active

# YAML
my-cli api users list --format yaml

# CSV (파이프에 적합)
my-cli api users list --format csv > users.csv
```

### --quiet / -q

출력을 억제합니다. exit code만으로 성공/실패를 판단할 때 사용합니다.

```bash
my-cli api users create --name "John" --email "john@example.com" --quiet
echo $?  # 0 = 성공, 1 = 실패
```

### --debug

디버그 정보를 출력합니다. 에러 발생 시 상세 정보(details, stack trace)를 포함합니다.

```bash
my-cli api users list --debug
```

### --no-color

색상과 이모지를 비활성화합니다. CI/CD 환경이나 로그 파일 기록에 적합합니다.

```bash
my-cli auth status --no-color
# [OK] valid  (✓ 대신 [OK])
# [X] expired (✗ 대신 [X])
```

환경변수로도 제어할 수 있습니다:
- `NO_COLOR=1` - 색상 비활성화
- `TERM=dumb` - 색상 비활성화
- `FORCE_COLOR=1` - 색상 강제 활성화 (다른 설정보다 우선)

### 테이블 출력

기본 출력 형식인 테이블은 다음과 같이 동작합니다:

- API 응답에서 배열 데이터를 자동 추출합니다 (`data`, `items` 필드 또는 직접 배열)
- 열 너비를 자동 계산합니다
- 한글/CJK 문자의 터미널 display width를 올바르게 처리합니다
- 헤더는 대문자로 표시됩니다

```
NAME                DESCRIPTION              ID  OWNER_ID
------------------  -----------------------  --  -------------
My Load Test Group  A group for load tests   1   ad-ai-serving
pl model            웹검색광고 부하 테스트     15  ad-ai-serving
```

### 상태 변경 알림

GET 이외의 HTTP method(POST, PUT, PATCH, DELETE) 요청이 성공하면, TTY 환경에서 stderr로 간단한 알림을 출력합니다:

```bash
my-cli api users create --name "John" --email "john@example.com" --json
# stderr: POST 요청 완료 (234ms)
# stdout: {"id": 1, "name": "John", ...}
```

이 알림은 stderr로 출력되므로 stdout 파이프를 오염시키지 않습니다. `--quiet`로 억제할 수 있습니다.

### Spinner

TTY 환경에서 `--quiet`가 아닌 경우, 요청 중에 spinner 애니메이션이 stderr에 표시됩니다:

```
⠋ 요청 중...
```

요청이 완료되면 spinner는 자동으로 지워집니다.
