# Quickstart - 빠른 시작 가이드

이 가이드는 union-cli로 첫 번째 팀 전용 CLI를 만드는 과정을 안내합니다.
scaffold부터 API 호출까지 **5분**이면 충분합니다.

---

## 1. 프로젝트 생성

`create-union-cli`로 프로젝트를 scaffold합니다:

```bash
npx create-union-cli my-cli
```

실행하면 프로젝트 이름과 CLI 커맨드명을 물어봅니다:

```
  ? Project name: my-cli
  ? CLI command name (my-cli):

  Creating union-cli project my-cli

  create  package.json
  create  tsconfig.json
  create  bin/run.js
  create  bin/dev.js
  create  src/index.ts
  create  plugins/example-api.yaml
  create  README.md
  create  .gitignore

  Installing dependencies...

  Done! Project my-cli created.
```

`package.json`, 진입점(`bin/run.js`), 예제 YAML manifest(`plugins/example-api.yaml`)까지 전부 생성되고 `npm install`까지 자동으로 완료됩니다.

## 2. 빌드

```bash
cd my-cli
npm run build
# 5 commands generated
```

`plugins/` 디렉토리의 YAML manifest를 읽어서 oclif Command JS 파일을 `dist/commands/`에 생성합니다.

## 3. 실행

scaffold에 포함된 예제는 [JSONPlaceholder](https://jsonplaceholder.typicode.com) API를 사용하므로, 인증 없이 바로 실행할 수 있습니다:

```bash
# 도움말
npx my-cli --help

# 게시글 목록 조회
npx my-cli api posts list --json

# 특정 유저의 게시글만 필터
npx my-cli api posts list --userId 1 --json

# 게시글 상세 조회
npx my-cli api posts get 1 --json

# 게시글 생성
npx my-cli api posts create --title "Hello" --body "World" --json
```

### 출력 형식

모든 커맨드에 표준 출력 플래그가 자동으로 적용됩니다:

```bash
npx my-cli api posts list                    # 테이블 (기본)
npx my-cli api posts list --json             # JSON
npx my-cli api posts list --format yaml      # YAML
npx my-cli api posts list --format csv       # CSV
npx my-cli api posts list --quiet            # 출력 없음 (exit code만)
```

### 개발 모드

빌드 없이 바로 실행하려면 `bin/dev.js`를 사용합니다:

```bash
./bin/dev.js api posts list --json
```

## 4. 내 API로 교체하기

예제 manifest를 수정하거나, 새 YAML 파일을 `plugins/`에 추가합니다:

```yaml
# plugins/my-service.yaml
name: my-service
namespace: svc
description: "내 서비스 REST API"

provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: bearer
      token:
        env: "MY_API_TOKEN"
    timeout: 30000

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
        description: "조회 개수"
        httpMap: query
      - name: status
        type: string
        options: ["active", "inactive"]
        description: "사용자 상태 필터"
        httpMap: query
    examples:
      - "my-cli svc users list --limit 50"
      - "my-cli svc users list --status active --json"

  - id: users:get
    description: "사용자 상세 조회"
    http:
      method: GET
      path: "/users/{user_id}"
    args:
      - name: user_id
        required: true
        description: "사용자 ID"
    examples:
      - "my-cli svc users get user-123 --json"

  - id: users:create
    description: "사용자 생성"
    http:
      method: POST
      path: "/users"
    flags:
      - name: name
        required: true
        description: "사용자 이름"
        httpMap: body
      - name: email
        required: true
        description: "이메일 주소"
        httpMap: body
      - name: role
        description: "역할"
        default: "member"
        httpMap: body
    examples:
      - "my-cli svc users create --name 'John Doe' --email john@example.com"
```

다시 빌드하면 새 커맨드가 추가됩니다:

```bash
npm run build
npx my-cli svc users list --json
```

## 5. 인증 설정

### 환경변수 방식 (Bearer Token)

가장 간단한 방식입니다:

```bash
export MY_API_TOKEN="your-secret-token"
npx my-cli svc users list --json
```

### Cookie 기반 OAuth 로그인

브라우저 기반 OAuth 로그인을 사용하는 경우:

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: cookie
      serviceName: "my-service"
```

```bash
npx my-cli auth login          # 브라우저에서 OAuth 로그인
npx my-cli auth status         # 인증 상태 확인
npx my-cli auth logout         # 로그아웃
```

### JWT 자동 토큰 발급

username/password로 토큰을 자동 발급받는 경우:

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: jwt
      tokenEndpoint: "/auth/token"
      tokenTTL: 1800
      credentials:
        username:
          env: "API_USER"
        password:
          env: "API_PASS"
```

```bash
export API_USER="admin"
export API_PASS="password"
npx my-cli svc users list --json
# 자동으로 JWT 토큰을 발급받아 사용합니다
```

## 6. 시스템 진단

빌드와 인증 상태를 한눈에 확인할 수 있습니다:

```bash
npx my-cli doctor
# 시스템 상태:
#   Node.js: v20.10.0 ✓
#   작업 디렉토리: /path/to/my-cli ✓
#   매니페스트: 1개 ✓
#   토큰: ✓
#
# Provider 상태:
#   api: ✓ ok
```

## 생성된 프로젝트 구조

```
my-cli/
├── bin/
│   ├── run.js          # CLI 진입점
│   └── dev.js          # 개발 모드 진입점 (빌드 없이 실행)
├── plugins/
│   └── example-api.yaml  # YAML manifest (여기에 커맨드를 선언)
├── dist/
│   └── commands/         # 빌드 시 생성되는 oclif Command 파일들
├── src/
│   └── index.ts
├── package.json
└── tsconfig.json
```

핵심은 `plugins/*.yaml`만 작성하면 된다는 것입니다. `npm run build`가 나머지를 처리합니다.

## 다음 단계

- [Architecture](./architecture.md) - 5-Layer 아키텍처 이해
- [Providers](./providers.md) - HTTP, CLI, Python, JS Provider 상세 가이드
- [Manifest Reference](./manifest-reference.md) - YAML Manifest 전체 레퍼런스
- [Auth](./auth.md) - 인증 설정 상세 가이드
- [Commands](./commands.md) - Built-in 커맨드 가이드
