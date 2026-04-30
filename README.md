# union-cli

> [English](./README.en.md) | 한국어

> YAML 선언으로 통합 CLI 생성하는 프레임워크

---

## Quickstart

### 1. 프로젝트 생성

```bash
npx create-union-cli my-cli
cd my-cli
```

### 2. YAML Manifest 작성

```yaml
# plugins/my-api.yaml
name: my-api
namespace: api
description: "내 서비스 API"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: bearer
      token:
        env: "MY_API_TOKEN"

commands:
  - id: users:list
    description: "사용자 목록"
    http:
      method: GET
      path: "/users"
    flags:
      - name: limit
        type: number
        default: 20
        httpMap: query

  - id: users:create
    description: "사용자 생성"
    http:
      method: POST
      path: "/users"
    flags:
      - name: name
        required: true
        httpMap: body
      - name: email
        required: true
        httpMap: body
```

### 3. 빌드 & 실행

```bash
npm run build
# 4 commands generated

npx my-cli --help
npx my-cli api users list --json
npx my-cli api users create --name "John" --email "john@example.com" --json
```

---

## Provider 타입

| Provider | 용도 | 통신 방식 | 부가 기능 |
|----------|------|-----------|-----------|
| **HTTP** | REST API 호출 | `fetch` | retry (exponential backoff + jitter, Retry-After 존중) |
| **CLI** | 외부 바이너리 래핑 | `spawn` | output 파서 (json/lines/csv/regex) |
| **Python** | Python 함수 호출 | JSON-RPC over stdio | persistent/oneshot, venv |
| **JS** | Node.js 모듈 호출 | in-process ESM/CJS | 모듈 캐싱 |

---

## 인증

| 타입 | 설정 | 동작 |
|------|------|------|
| `none` | `type: none` | 인증 없이 요청 |
| `bearer` | `type: bearer` + `token` | `Authorization: Bearer {token}` |
| `basic` | `type: basic` + `credentials` | `Authorization: Basic {base64}` |
| `jwt` | `type: jwt` + `tokenEndpoint` | 자동 토큰 발급 + TTL 캐싱 |
| `api-key` | `type: api-key` + `headerName` | `{headerName}: {token}` |
| `cookie` | `type: cookie` + `serviceName` | OAuth 브라우저 로그인 → 쿠키 저장 |

```yaml
auth:
  type: bearer
  token:
    env: "MY_API_TOKEN"     # 환경변수
    file: "/path/to/token"  # 파일
    command: "vault read"   # 커맨드 실행
```

---

## Built-in 커맨드

union-cli를 oclif 플러그인으로 등록하면 아래 커맨드가 자동으로 제공됩니다:

```bash
my-cli auth login               # 전체 provider 순차 로그인
my-cli auth login <namespace>   # 특정 provider만 로그인
my-cli auth status              # 인증 상태 테이블
my-cli auth status --verify     # API 호출로 실제 유효성 확인
my-cli auth logout              # 전체 로그아웃
my-cli auth token <namespace>   # 토큰 출력 (파이프용)

my-cli doctor                   # 시스템 + provider 상태 확인
my-cli doctor --json

my-cli plugin add <pkg-or-path> # npm 패키지/로컬 경로/git URL 플러그인 등록
my-cli plugin list              # 등록된 플러그인 목록 (table/--json)
my-cli plugin remove <name>     # 플러그인 제거 (--purge 로 로컬 파일 삭제)
```

```
NAMESPACE   AUTH TYPE  STATUS     EXPIRES
---------   ---------  ---------  -------------------
api         bearer     ✓ valid    2026-04-07 09:18:50
auth-svc    cookie     ✗ expired  2026-04-07 08:32:50
public      none       ✓ (no auth)
```

---

## 출력 형식

모든 커맨드에 표준 플래그가 자동 적용됩니다:

```bash
my-cli api users list                    # 테이블 (기본)
my-cli api users list --json             # JSON
my-cli api users list --format yaml      # YAML
my-cli api users list --format csv       # CSV
my-cli api users list --quiet            # 출력 없음 (exit code만)
```

**색상**: TTY 환경에서 자동으로 ANSI 색상이 적용됩니다 (에러=빨강, 성공=초록, 경고=노랑, 헤더=bold). JSON/YAML 은 raw 보존(파이프/리다이렉트 안전).
- `NO_COLOR=1` 또는 `--no-color`: 비활성화
- `FORCE_COLOR=1`: 강제 활성화 (non-TTY 환경에도)
- `TERM=dumb`: 자동 비활성화

## Credential 저장소

manifest 의 `provider.config.credentialStore` 로 저장 방식을 선택할 수 있습니다.

| 값 | 동작 | 사용 사례 |
|----|------|-----------|
| `file` (기본) | `~/.<cli-name>/credentials/<ns>.json` (chmod 0600) | 기본/개인 |
| `keychain` | macOS Keychain · Linux libsecret · Windows Credential Manager | 데스크톱 |
| `env` | `<CLI>_<NS>_TOKEN` 환경변수 (read-only) | CI/CD |

`keychain` 선택 시 OS CLI(`security` / `secret-tool` / `cmdkey`) 가 PATH 에 없으면 `file` 로 graceful fallback.

## HTTP Retry

manifest 의 `provider.config.retry` 로 자동 재시도 정책을 설정할 수 있습니다.

```yaml
provider:
  type: http
  config:
    baseUrl: https://api.example.com
    retry:
      attempts: 3
      retryOn: [429, 500, 502, 503, 504]
      jitter: full              # full | equal | none
      idempotent: auto          # auto = GET/HEAD/PUT/DELETE 만 retry
```

- 401 은 retry 정책 미적용 (auth-handlers 의 JWT refresh 가 처리)
- `Retry-After` 헤더가 있으면 우선 (단 `maxDelayMs` cap)

## HTTP Pagination

cursor / offset / link-header 3종 페이지네이션을 manifest 로 선언할 수 있습니다.

```yaml
provider:
  type: http
  config:
    baseUrl: https://api.example.com
    pagination:
      style: cursor              # cursor | offset | link-header
      pageParam: cursor
      itemsPath: data
      nextPath: meta.next_cursor
      maxPages: 100
```

명령 실행 시 `--all` 플래그를 주면 모든 페이지를 누적해 단일 array 로 반환합니다. retry 정책과도 자동 통합 (각 페이지 요청에 retry 적용).

## Interactive Prompt

TTY 환경에서 required flag 가 누락되면 자동으로 prompt 됩니다 (`password`/`token`/`secret` 등은 hidden 입력).

```bash
my-cli api users create     # email 누락 시 prompt
> ? email: john@example.com
```

- `--no-input` flag 또는 `NO_INPUT=1`/`UNION_CLI_NO_INPUT=1` 환경변수로 비활성화 (CI/스크립트용)
- non-TTY 환경에서는 자동으로 prompt 미실행 → oclif 의 missing-flag 에러로 fallback

## Windows 지원

- Python provider 의 venv 경로가 win32 에서 자동으로 `Scripts/python.exe` 로 분기됩니다.
- CI matrix 가 `ubuntu-latest` × `windows-latest` × `macos-latest` × `node 20/22` = 6 조합으로 검증됩니다.

## 테스트

```bash
npm test              # 전체 (unit + e2e)
npm run test:unit     # unit 만 (빠름)
npm run test:e2e      # e2e 만 (./bin/dev.js 통합 검증)
npm run test:coverage # 커버리지 포함
npm run format        # prettier 자동 포맷
npm run format:check  # CI 용 포맷 검증
```

E2E 는 `./bin/dev.js` (tsx) 를 사용해 `npm run build` 의존성 없이 실행됩니다.

## 추가 기능

| 기능 | 설명 | 비활성화 |
|------|------|---------|
| **Pager** | TTY + 긴 출력 시 `less -R` (또는 `$PAGER`) 자동 적용 | `NO_PAGER=1`, `PAGER=''` |
| **Did-you-mean** | 알 수 없는 명령 입력 시 Levenshtein 거리 기반 후보 제안 (정적 + 동적 namespace) | — |
| **Proxy** | `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` env 자동 인식 (undici ProxyAgent) | env 미설정 |
| **Audit log** | `~/.<cli-name>/audit.log` 에 호출 기록 (JSONL, chmod 0600, 민감 flag 마스킹) | `NO_AUDIT=1`, `--audit-off` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Interface                                         │
│  plugins/*.yaml — 사용자가 작성하는 유일한 파일                │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Build                                             │
│  YAML 파싱 → 검증 → Codegen (oclif Command JS 파일 생성)     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: CLI (oclif)                                       │
│  커맨드 파싱, 표준 플래그, 도움말, 자동완성                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Provider                                          │
│  HTTP (fetch) · CLI (spawn) · Python (JSON-RPC) · JS (ESM)  │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: Core Infrastructure                               │
│  Auth · Output · Config · CredentialStore · Error           │
└─────────────────────────────────────────────────────────────┘
```

---

## Examples

각 Provider 별 동작하는 샘플 프로젝트:

- [http-jsonplaceholder](./examples/http-jsonplaceholder) — HTTP provider, JSONPlaceholder REST API
- [cli-wrap](./examples/cli-wrap) — CLI provider, git command wrapping
- [python-sdk](./examples/python-sdk) — Python provider, numpy stats via JSON-RPC
- [js-module](./examples/js-module) — JS provider, local ESM functions in-process

---

## Shell Completion

zsh / bash / fish 자동완성을 설치하려면:

```bash
my-cli completion install              # SHELL 환경변수로 자동 감지
my-cli completion install zsh          # 명시적
my-cli completion install bash --apply # ~/.bashrc 직접 수정 (위험)
my-cli completion install fish --dry-run --apply
```

`--apply` 없이는 안내 + 스크립트만 stdout 으로 출력합니다 (안전 기본값).

---

## 관련 문서

- [Architecture (Docs)](https://kimsoungryoul.github.io/union-cli/) — 5-Layer 아키텍처 + 실행 흐름
- [plan.md](./plan.md) — 프레임워크 설계 계획

---

## License

MIT
