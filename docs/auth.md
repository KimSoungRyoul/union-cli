# Auth - 인증 가이드

union-cli는 다양한 인증 방식을 지원합니다. 이 문서에서는 각 인증 타입의 설정 방법과 동작 원리를 설명합니다.

---

## 지원 인증 타입

| 타입 | 동작 | 사용 사례 |
|------|------|-----------|
| `none` | 인증 없이 요청 | 공개 API |
| `bearer` | `Authorization: Bearer {token}` | 대부분의 API |
| `basic` | `Authorization: Basic {base64}` | 기본 인증 |
| `jwt` | 자동 토큰 발급 + TTL 캐싱 | 토큰 자동 갱신이 필요한 API |
| `api-key` | `{headerName}: {token}` | API Key 인증 |
| `cookie` | OAuth 브라우저 로그인 -> 쿠키 저장 | SSO/OAuth 기반 서비스 |

---

## SecretRef - 비밀값 참조

토큰, 비밀번호 등 민감한 값은 YAML에 직접 넣지 않고 **SecretRef**로 참조합니다. 4가지 소스를 지원합니다:

### env - 환경변수

```yaml
token:
  env: "MY_API_TOKEN"
```

`process.env.MY_API_TOKEN`에서 읽습니다. 가장 일반적인 방식입니다.

```bash
export MY_API_TOKEN="your-secret-token"
my-cli api users list
```

### file - 파일

```yaml
token:
  file: "/path/to/token.txt"
```

파일 내용을 읽어 토큰으로 사용합니다. Kubernetes Secret mount, Docker Secret 등에 적합합니다.

### command - 커맨드 실행

```yaml
token:
  command: "vault read -field=token secret/api"
```

셸 커맨드를 실행하고 stdout 결과를 토큰으로 사용합니다. HashiCorp Vault, AWS Secrets Manager 등 외부 Secret 관리 도구와 연동할 때 유용합니다.

### value - 직접 값

```yaml
token:
  value: "literal-token"
```

테스트/개발 용도로만 사용하세요. 프로덕션에서는 사용하지 마세요.

### SecretRef 해석 우선순위

여러 소스가 지정된 경우 `env` -> `file` -> `command` -> `value` 순서로 첫 번째 유효한 값을 사용합니다. 모든 소스에서 값을 찾지 못하면 `null`을 반환합니다.

---

## none - 인증 없음

공개 API에 사용합니다. 인증 헤더가 추가되지 않습니다.

```yaml
provider:
  type: http
  config:
    baseUrl: "https://public-api.example.com/v1"
    auth:
      type: none
```

`auth` 설정 자체를 생략해도 동일하게 동작합니다.

---

## bearer - Bearer Token

가장 일반적인 API 인증 방식입니다. `Authorization: Bearer {token}` 헤더를 추가합니다.

### 설정

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: bearer
      token:
        env: "API_TOKEN"
```

### 동작

1. SecretRef에서 토큰 값을 해석합니다.
2. 요청 헤더에 `Authorization: Bearer {token}`을 추가합니다.
3. 토큰이 비어있으면 경고 메시지를 출력합니다.

### 사용

```bash
export API_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
my-cli api users list --json
```

---

## basic - Basic 인증

username:password를 Base64로 인코딩하여 `Authorization: Basic {base64}` 헤더를 추가합니다.

### 설정

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: basic
      credentials:
        username:
          env: "API_USER"
        password:
          env: "API_PASS"
```

### 동작

1. credentials에서 username과 password를 해석합니다.
2. `{username}:{password}`를 Base64로 인코딩합니다.
3. 요청 헤더에 `Authorization: Basic {encoded}`를 추가합니다.
4. username 또는 password가 비어있으면 경고 메시지를 출력합니다.

### 사용

```bash
export API_USER="admin"
export API_PASS="secret123"
my-cli api users list --json
```

---

## jwt - JWT 자동 토큰 발급

username/password로 토큰 endpoint에 POST 요청을 보내 access_token을 자동으로 발급받습니다. TTL 동안 캐싱하여 매 요청마다 토큰을 재발급하지 않습니다.

### 설정

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: jwt
      tokenEndpoint: "/auth/token"     # baseUrl + tokenEndpoint에 POST
      tokenTTL: 1800                   # 캐싱 TTL (초, 기본 1800 = 30분)
      credentials:
        username:
          env: "JWT_USER"
        password:
          env: "JWT_PASS"
```

### 동작

```
1. 캐시 확인
   └─ 유효한 캐시 토큰이 있으면 바로 사용

2. 토큰 발급 (캐시 미스 또는 만료 시)
   └─ POST {baseUrl}/auth/token
   └─ Body: {"username": "...", "password": "..."}
   └─ Content-Type: application/json
   └─ 타임아웃: 10초

3. 토큰 추출
   └─ 응답에서 access_token 또는 token 필드를 추출

4. 캐싱
   └─ TTL - 30초 여유를 두고 캐싱
   └─ (예: TTL 1800초 -> 1770초 동안 캐시)

5. 헤더 적용
   └─ Authorization: Bearer {access_token}
```

### 사용

```bash
export JWT_USER="admin"
export JWT_PASS="password"
my-cli api users list --json
# 첫 요청: 토큰 자동 발급 -> API 호출
# 두 번째 요청: 캐시된 토큰으로 바로 API 호출
```

### 토큰 응답 형식

토큰 endpoint는 다음 중 하나의 형식으로 응답해야 합니다:

```json
{"access_token": "eyJ..."}
```

또는:

```json
{"token": "eyJ..."}
```

`access_token` 필드가 우선됩니다.

---

## api-key - API Key

커스텀 헤더에 API key를 전송합니다.

### 설정

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: api-key
      token:
        env: "API_KEY"
      headerName: "X-API-Key"     # 헤더 이름 (기본값: X-API-Key)
```

### 동작

1. SecretRef에서 token 값을 해석합니다.
2. 요청 헤더에 `{headerName}: {token}`을 추가합니다.
3. `headerName`을 생략하면 기본값 `X-API-Key`를 사용합니다.

### 사용

```bash
export API_KEY="ak-1234567890"
my-cli api users list --json
# -> 요청 헤더: X-API-Key: ak-1234567890
```

### 커스텀 헤더 이름

```yaml
auth:
  type: api-key
  token:
    env: "AUTH_TOKEN"
  headerName: "X-Auth-Token"
# -> 요청 헤더: X-Auth-Token: {token}
```

---

## cookie - OAuth 브라우저 로그인

브라우저에서 OAuth 로그인 후 쿠키를 추출하여 저장합니다. SSO 기반 서비스에 적합합니다.

### 설정

```yaml
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: cookie
      serviceName: "my-service"   # tokens.json에서 사용할 키
      tokenFile: null             # 선택. 토큰 파일 경로 (기본: .union-cli/tokens.json)
```

### 로그인 흐름

```
1. my-cli auth login
   └─ GET {baseUrl}/api/v1/auth/login
   └─ 응답에서 auth_url 추출
   └─ 브라우저에서 auth_url 열기 (OAuth 로그인 페이지)
   └─ 사용자가 브라우저에서 로그인

2. 쿠키 추출
   └─ Chrome 쿠키 DB에서 해당 호스트의 쿠키 복호화
   └─ macOS Chrome Safe Storage 키로 AES 복호화

3. 토큰 저장
   └─ .union-cli/tokens.json에 쿠키 문자열 저장
   └─ { "my-service": { "cookies": "session=...; token=...", "savedAt": "..." } }
```

### 요청 시 동작

1. `.union-cli/tokens.json`에서 `serviceName`에 해당하는 쿠키를 읽습니다.
2. 요청 헤더에 `Cookie: {cookies}`를 추가합니다.
3. 쿠키에서 `*_token` 패턴의 값을 추출하여 `Authorization: Bearer {token}` 헤더도 추가합니다 (API 호환성).
4. 쿠키가 없으면 `"auth login" 먼저 실행하세요` 경고를 출력합니다.

### 사용

```bash
# 로그인
my-cli auth login
# -> 브라우저에서 OAuth 로그인
# -> Enter를 누르세요
# -> 2개 쿠키 저장 완료

# API 호출 (저장된 쿠키 자동 사용)
my-cli api users list --json

# 상태 확인
my-cli auth status

# 로그아웃
my-cli auth logout
```

---

## CredentialStore

인증 정보를 파일 시스템에 저장하고 관리하는 컴포넌트입니다.

### tokens.json

Cookie 인증에서 사용하는 토큰 파일입니다.

위치: `.union-cli/tokens.json` (프로젝트 루트 기준)

```json
{
  "my-service": {
    "cookies": "session_token=eyJ...; refresh_token=eyJ...",
    "savedAt": "2026-04-07T09:00:00.000Z"
  },
  "other-service": {
    "cookies": "auth_token=abc123",
    "savedAt": "2026-04-07T08:30:00.000Z"
  }
}
```

### FileCredentialStore

파일 기반 인증 정보 저장소입니다.

- 위치: `~/.my-cli/credentials/<namespace>.json`
- 파일 권한: `0600` (소유자만 읽기/쓰기)
- 인터페이스:

```typescript
interface CredentialStore {
  get(ns: string): Promise<Record<string, string> | null>;
  set(ns: string, creds: Record<string, string>): Promise<void>;
  delete(ns: string): Promise<void>;
}
```

### EnvCredentialStore

환경변수 기반 인증 정보 저장소입니다. 읽기 전용입니다.

```bash
# namespace가 "api"인 경우
export API_TOKEN="your-token"
# EnvCredentialStore.get("api") -> {"token": "your-token"}
```

---

## Auth CLI 커맨드

### auth login

Provider별 인증 로그인을 수행합니다.

```bash
# 전체 provider 순차 로그인
my-cli auth login

# 특정 namespace만 로그인
my-cli auth login api
```

**auth type별 동작:**

| Auth Type | 로그인 방식 |
|-----------|-------------|
| `none` | 건너뜀 ("인증 불필요" 출력) |
| `cookie` | 브라우저 OAuth 로그인 -> Chrome 쿠키 추출 -> tokens.json 저장 |
| `bearer` / `api-key` | 토큰 직접 입력 프롬프트 -> tokens.json 저장 |
| `jwt` | 미지원 경고 (자동 토큰 발급 방식이므로 별도 로그인 불필요) |

**플래그:**

| 플래그 | 설명 |
|--------|------|
| `--json` | 결과를 JSON으로 출력 |
| `--no-color` | 색상/이모지 비활성화 |

### auth logout

인증 정보를 삭제합니다.

```bash
# 전체 로그아웃 (tokens.json 삭제)
my-cli auth logout

# 특정 namespace만 로그아웃
my-cli auth logout api
```

### auth status

현재 인증 상태를 테이블로 표시합니다.

```bash
my-cli auth status
```

출력 예시:

```
NAMESPACE   AUTH TYPE  STATUS      EXPIRES
---------   ---------  ----------  -------------------
api         cookie     ✓ valid     2026-04-07 09:18:50
k8s-proxy   cookie     ✗ expired   2026-04-07 08:32:50
public      none       ✓ (no auth)
```

**상태 판별:**

1. `auth.type === 'none'`: `✓ (no auth)`
2. tokens.json에 쿠키가 있는 경우:
   - JWT 토큰이면 `exp` 클레임으로 만료 시각 확인
   - 유효: `✓ valid` + 만료 시각
   - 만료: `✗ expired` + 만료 시각
   - JWT가 아니면: `✓ token exists`
3. tokens.json에 쿠키가 없는 경우: `✗ not logged in`

**`--verify` 플래그:**

```bash
my-cli auth status --verify
```

`--verify`를 지정하면 실제 API 호출(`/api/v1/auth/me`)로 토큰 유효성을 검증합니다. JWT exp 확인만으로는 서버 측 토큰 무효화를 감지할 수 없을 때 사용합니다.

### auth token

특정 namespace의 토큰을 stdout으로 출력합니다. 다른 도구와 파이프로 연결할 때 사용합니다.

```bash
my-cli auth token api
# -> eyJhbGciOiJIUzI1NiIs...

# 다른 도구에 토큰 전달
curl -H "Authorization: Bearer $(my-cli auth token api)" https://api.example.com/v1/me
```

---

## 보안 권장사항

1. **SecretRef를 사용하세요**: YAML에 토큰이나 비밀번호를 직접 입력하지 마세요. `env`, `file`, `command`를 활용하세요.

2. **민감 플래그 이름을 피하세요**: `--password`, `--secret`, `--token` 등의 이름은 `ps` 명령어와 셸 히스토리에 노출됩니다. 빌드 시 경고가 출력됩니다.

3. **tokens.json을 버전 관리에서 제외하세요**:
   ```
   # .gitignore
   .union-cli/tokens.json
   .union-cli/credentials/
   ```

4. **프로덕션에서 `value` SecretRef를 사용하지 마세요**: `value`는 테스트 용도로만 사용하세요.

5. **파일 권한을 확인하세요**: FileCredentialStore는 자동으로 `0600` 권한을 설정하지만, tokens.json은 수동으로 권한을 확인하는 것이 좋습니다.
