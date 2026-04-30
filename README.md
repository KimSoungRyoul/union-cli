# union-cli

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

| Provider | 용도 | 통신 방식 |
|----------|------|-----------|
| **HTTP** | REST API 호출 | `fetch` |
| **CLI** | 외부 바이너리 래핑 | `spawn` |
| **Python** | Python 함수 호출 | JSON-RPC over stdio |
| **JS** | Node.js 모듈 호출 | in-process ESM/CJS |

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

## 관련 문서

- [Architecture (Docs)](https://kimsoungryoul.github.io/union-cli/) — 5-Layer 아키텍처 + 실행 흐름
- [plan.md](./plan.md) — 프레임워크 설계 계획

---

## License

MIT
