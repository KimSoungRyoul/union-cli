---
slug: /
sidebar_position: 1
title: "Quickstart"
description: "union-cli로 첫 번째 팀 전용 CLI를 만드는 단계별 튜토리얼. scaffold부터 API 호출까지 5분이면 충분합니다."
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Quickstart

YAML 선언 한 장으로 팀 전용 통합 CLI를 만드는 프레임워크입니다.

HTTP API, CLI 바이너리, Python 함수, JS 모듈을 하나의 CLI 인터페이스로 통합할 수 있습니다.

---

<Tabs>
<TabItem value="step1" label="Step 1. 프로젝트 생성" default>

## 프로젝트 생성

`create-union-cli`로 프로젝트를 scaffold합니다:

```bash
npx create-union-cli my-cli
```

프로젝트 이름과 CLI 커맨드명을 물어봅니다:

```bash
? Project name: my-cli
? CLI command name (my-cli):

# Creating union-cli project my-cli

create  package.json
create  tsconfig.json
create  bin/run.js
create  bin/dev.js
create  src/index.ts
create  plugins/example-api.yaml
create  README.md
create  .gitignore

# Installing dependencies...

# Done! Project my-cli created.
```

`package.json`, 진입점(`bin/run.js`), 예제 YAML manifest(`plugins/example-api.yaml`)까지 전부 생성되고 `npm install`까지 자동으로 완료됩니다.

### 생성된 프로젝트 구조

```
my-cli/
├── bin/
│   ├── run.js                # CLI 엔트리포인트
│   └── dev.js                # 개발 모드 (빌드 없이 실행)
├── plugins/
│   └── example-api.yaml      # JSONPlaceholder 예제 manifest
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── .gitignore
```

:::tip 기존 디렉토리에 생성
```bash
npx create-union-cli .
```
:::

</TabItem>
<TabItem value="step2" label="Step 2. 빌드 & 실행">

## 빌드 & 실행

### 빌드

```bash
cd my-cli
npm run build
```

```text
5 commands generated
```

`plugins/` 디렉토리의 YAML manifest를 읽어서 oclif Command JS 파일을 `dist/commands/`에 생성합니다.

:::info 빌드 과정
1. `plugins/` 디렉토리에서 YAML manifest 파일을 탐색
2. YAML을 파싱하고 스키마 검증
3. 각 커맨드에 대한 oclif Command JS 파일을 `dist/commands/`에 생성
4. `.union-cli/manifest.json`에 캐시 저장
:::

### 실행

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

</TabItem>
<TabItem value="step3" label="Step 3. 내 API 연결">

## 내 API로 교체하기

예제 manifest를 수정하거나, 새 YAML 파일을 `plugins/`에 추가합니다:

```yaml title="plugins/my-service.yaml"
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

:::danger 시크릿 관리 주의사항
YAML manifest에 **절대로 실제 토큰이나 비밀번호를 직접 작성하지 마세요.** 반드시 `env` 키를 사용하여 환경변수를 참조해야 합니다.

```yaml
# 올바른 방법
auth:
  type: bearer
  token:
    env: "MY_API_TOKEN"  # 환경변수 참조

# 절대 금지!
auth:
  type: bearer
  token: "eyJhbGciOiJIUzI1..."  # 실제 토큰 직접 작성 금지
```
:::

</TabItem>
<TabItem value="step4" label="Step 4. 인증 설정">

## 인증 설정

### Bearer Token (환경변수)

가장 간단한 방식입니다:

```yaml title="plugins/my-service.yaml (provider 부분)"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: bearer
      token:
        env: "MY_API_TOKEN"
```

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

:::danger
토큰을 셸 히스토리에 남기지 않으려면 `.env` 파일이나 시크릿 매니저를 사용하세요. **`.env` 파일은 반드시 `.gitignore`에 추가**해야 합니다.
:::

union-cli는 Bearer 외에도 다양한 인증 방식을 지원합니다:
- **Cookie/OAuth** -- 브라우저 기반 SSO 로그인. [인증 가이드 - Cookie](./auth#cookie---oauth-브라우저-로그인) 참조.
- **JWT 자동 발급** -- username/password로 토큰 자동 갱신. [인증 가이드 - JWT](./auth#jwt---jwt-자동-토큰-발급) 참조.

</TabItem>
<TabItem value="step5" label="Step 5. 시스템 진단">

## 시스템 진단

```bash
npx my-cli doctor
```

```text
시스템 상태:
  Node.js: v20.10.0 ✓
  작업 디렉토리: /path/to/my-cli ✓
  매니페스트: 1개 ✓
  토큰: ✓

Provider 상태:
  api: ✓ ok
```

:::tip
`doctor` 커맨드는 문제가 발생했을 때 가장 먼저 실행해야 할 명령어입니다. 매니페스트 로드 오류, 인증 만료, Provider 연결 실패 등을 진단해줍니다.
:::

</TabItem>
</Tabs>

---

## What's Next?

:::tip 다음 단계: 아키텍처 이해
[**Architecture 문서**](./architecture)에서 5-Layer 아키텍처의 전체 구조와 실행 흐름을 확인하세요. YAML manifest가 어떻게 CLI 커맨드로 변환되는지 이해하면 더 효과적으로 활용할 수 있습니다.
:::

- [**Providers**](./providers) - HTTP, CLI, Python, JS 4가지 Provider 타입 상세 가이드
- [**Manifest Reference**](./manifest-reference) - YAML Manifest 전체 스키마 레퍼런스
- [**Auth**](./auth) - 인증 방식별 상세 설정 가이드
- [**Commands**](./commands) - Built-in 커맨드(`doctor`, `auth`, `config`) 가이드
