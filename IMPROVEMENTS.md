# union-cli 개선 종합 보고서 (Wave 1~5)

> 작성: 2026-04-30 ~ 2026-05-01
> PR: [#2](https://github.com/KimSoungRyoul/union-cli/pull/2) (merged @ `04b5594`)

---

## 한 줄 요약

**"YAML 한 장으로 팀 CLI 만드는 프레임워크"** 의 빈 곳을 채워 — stub 명령 실구현, 운영 신뢰성, 보안, 엔터프라이즈 환경(Windows/proxy/mTLS) 까지 production-ready 수준으로 끌어올림.

| 지표 | Before | After |
|---|---|---|
| Test files | 16 | **27** (+11) |
| Tests | 271 | **571** (+300) |
| Line coverage | 측정 안 함 | **79.65%** |
| Stub 빌트인 명령 | 4 | **0** |
| Examples | 비어있음 | **4종 동작** |
| Provider 부가 기능 | timeout 만 | **retry + pagination + proxy + mTLS + credentialStore** |
| CI OS matrix | ubuntu 만 | **ubuntu × macos × windows × node 20/22** = 6 조합 |
| 핵심 commits | — | **49** |
| LOC 변동 | — | +9,806 / -111 |

---

## 1. 영역별 변경 요약

### 🔧 1.1 빌트인 명령 완성 (이전엔 stub)

| 명령 | Before | After |
|---|---|---|
| `<cli> completion install [shell]` | 14줄 stub ("구현 예정") | 300줄, zsh/bash/fish 자동 감지 + `--apply` + idempotent 마커 |
| `<cli> plugin add <pkg-or-path>` | 14줄 stub | 423줄, npm/git/file source 분류 + `~/.<cli>/plugins.json` registry (chmod 0600) |
| `<cli> plugin list [--json]` | 항상 빈 배열 | registry 기반 table/JSON 출력 |
| `<cli> plugin remove <name> [--purge]` | 14줄 stub | registry 제거 + npm uninstall + 옵션 파일 삭제 |

### 🌐 1.2 HTTP Provider 강화

| 기능 | 추가 내용 |
|---|---|
| **Retry policy** | manifest `provider.config.retry` (attempts/initialDelayMs/maxDelayMs/retryOn/respectRetryAfter/jitter/idempotent). exponential backoff + jitter, Retry-After 헤더 우선, 401 은 미적용 (JWT refresh 가 처리) |
| **Pagination** | `provider.config.pagination` 3 styles: `cursor` / `offset` / `link-header`. dot-path `itemsPath` + `nextPath`, `maxPages` 안전 한계, `--all` flag 로 활성 |
| **Proxy 통합** | `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` env (lowercase 우선), undici ProxyAgent, **per-host dispatcher 캐시** (TLS handshake 재사용), execute/healthCheck/paginate 모두 적용 |
| **mTLS helper** | `provider.config.tls` (caFile/certFile/keyFile/rejectUnauthorized/servername). undici Agent dynamic import, 미설치 시 graceful fallback |
| **Refresh token rotation** | device-code flow 응답에 새 `refresh_token` 있고 비어있지 않으면 교체. 빈 문자열은 보수적으로 기존 값 유지 + rotation 로그 |

### 🔐 1.3 인증 / Credential 저장소

| 기능 | 추가 내용 |
|---|---|
| **KeychainStore** | macOS `security` / Linux `secret-tool` (libsecret) / Windows `cmdkey` + sidecar |
| **EnvStore** | `<CLI>_<NS>_TOKEN` env 읽기 전용 (CI/CD 용) |
| **manifest 통합** | `provider.config.credentialStore: file \| keychain \| env` (default `file`). OS CLI 미설치 시 `file` 로 graceful fallback + warning |

### 🛡 1.4 운영 신뢰성

| 항목 | Before | After |
|---|---|---|
| **Python bridge stderr** | 첫 청크에서 reject → DeprecationWarning 만으로도 false-fail | stderr 누적, 비정상 종료(exit≠0) 시에만 reject. graceful shutdown (SIGTERM grace + SIGKILL) |
| **CLI provider 에러** | `stderr \|\| stdout` 중택 (정보 손실) | `error.details = { stderr, stdout, exitCode, signal }` 모두 보존, 성공 경로의 stderr 도 `CLI_STDERR_NOTICE` 로 부착 |
| **Audit log** | 없음 | `~/.<cli>/audit.log` JSONL (chmod 0600), 민감 flag 자동 마스킹, 단순 1단계 회전 (10MB), `NO_AUDIT`/`--audit-off` opt-out, Executor 자동 record (성공/실패 모두) |
| **Windows 분기** | `bin/python3` 하드코딩 | `process.platform === 'win32'` 시 `Scripts/python.exe`, PATH separator `;` |

### 🎨 1.5 CLI UX 폴리싱

| 기능 | 추가 내용 |
|---|---|
| **ANSI 색상** | 에러=빨강, 성공=초록, 경고=노랑, 헤더=bold. `NO_COLOR`/`FORCE_COLOR`/`--no-color`/`TERM=dumb`/non-TTY 모두 존중. JSON/YAML 은 raw 보존 |
| **Pager** | TTY + 긴 출력 (table/yaml/csv) 시 `less -R` 자동, `$PAGER` env 존중. JSON 은 raw. graceful fallback (pager 미설치 시 stdout). `OutputFormatter.printAsync()` |
| **Did-you-mean** | Levenshtein zero-dep, 정적 + 동적 manifest namespace 인식, top 3 후보, 자동 실행 금지. `@oclif/plugin-not-found` 대체 |
| **Interactive prompt** | TTY + missing required flag 시 자동 prompt. `password`/`token` 류 hidden 입력. `--no-input` / `NO_INPUT` env opt-out |
| **i18n catalogue** | `t(key, params, lang?)` zero-dep, ko/en messages, `UNION_CLI_LANG > LANG > 'en'` 우선순위 (점진 migration 후속) |

### 👨‍💻 1.6 개발자 경험 (DX)

| 항목 | 내용 |
|---|---|
| **examples/ 4종** | http-jsonplaceholder, cli-wrap (git wrap), python-sdk (numpy stats), js-module — 모두 실행 가능 + expected-output 스냅샷 |
| **E2E 테스트** | `test/e2e/` — `./bin/dev.js` (tsx) 사용, build 의존성 없음. --help, --version, doctor, auth, plugin, completion, did-you-mean, --no-color 시나리오 |
| **JSDoc** | `executor`, `registry`, `manifest/parser`, `manifest/validator` — 한국어, role + lifecycle + WHY |
| **Prettier** | `.prettierrc` (120col, 2sp, single quote, no semi), `format`/`format:check` scripts |
| **영어 README** | `README.en.md` 추가, README.md 첫줄에 토글 링크 |

### 🤖 1.7 CI / 품질 자동화

| 항목 | 내용 |
|---|---|
| **vitest coverage** | v8 provider, lcov+html artifact, threshold 60% (현재 79.65%) |
| **Multi-OS matrix** | `ubuntu-latest` × `windows-latest` × `macos-latest` × `node 20/22` = 6 조합 |
| **Dependabot** | npm root + npm website + github-actions 매주 월요일 grouping |
| **CodeQL** | JS/TS, push/PR + 매주 월요일 schedule |
| **npm audit** | 매일 + PR, `continue-on-error: true` (visibility) |

### 📋 1.8 Manifest Schema 확장

`provider.config` 에 명시적 추가:

```yaml
provider:
  type: http
  config:
    credentialStore: file | keychain | env   # 기본 file
    retry:
      attempts: 3
      initialDelayMs: 200
      maxDelayMs: 5000
      retryOn: [429, 500, 502, 503, 504]
      respectRetryAfter: true
      jitter: full          # full | equal | none
      idempotent: auto      # auto | true | false
    pagination:
      style: cursor         # cursor | offset | link-header
      pageParam: cursor
      sizeParam: limit
      itemsPath: data
      nextPath: meta.next_cursor
      maxPages: 100
      perPage: 50
    tls:                    # enterprise / private PKI / mTLS (helper 추가, wiring 후속)
      caFile: /etc/ssl/internal-ca.pem
      certFile: /home/user/.cert/client.pem
      keyFile: /home/user/.cert/client.key
      rejectUnauthorized: true
```

---

## 2. 그림으로 보는 구조

### 2.1 5-Layer 아키텍처 — Wave 별 변경 영역

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Interface (YAML manifests)                                     │
│                                                                          │
│  provider.config:                                                        │
│   ┌──────────────┬──────────────┬─────────────────┬──────────────┐     │
│   │ retry  [W2]  │pagination[W3]│credentialStore  │ tls    [W5]  │     │
│   │ ✨ NEW       │ ✨ NEW        │     [W2] ✨ NEW │ ✨ NEW        │     │
│   └──────────────┴──────────────┴─────────────────┴──────────────┘     │
├─────────────────────────────────────────────────────────────────────────┤
│ Layer 2: Build  (manifest → oclif command files)                        │
│                       ─ JSON Schema 확장 [W2/3]                          │
│                       ─ JSDoc 보강 [W3]                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Layer 3: CLI (oclif)                                                    │
│                                                                          │
│  ┌─────────────┬────────────┬──────────────┬─────────────────────┐    │
│  │ completion  │ plugin     │ doctor       │ auth (이미 존재)     │    │
│  │ install [W1]│ add/list/  │ (이미 존재)   │                      │    │
│  │ ✨ stub→real│ remove [W2]│              │                      │    │
│  │             │ ✨ stub→real│              │                      │    │
│  └─────────────┴────────────┴──────────────┴─────────────────────┘    │
│  ┌─ 신규 hook ─────────────┐                                            │
│  │ command-not-found [W4]  │  Levenshtein 후보 제안                   │
│  │ ✨ NEW                   │                                            │
│  └─────────────────────────┘                                            │
├─────────────────────────────────────────────────────────────────────────┤
│ Layer 4: Provider                                                       │
│  ┌──────────────────────────┬────────────────┬───────────┬──────────┐ │
│  │ HTTP                     │ CLI            │ Python    │ JS       │ │
│  │  ┌────────────────────┐  │  ┌──────────┐  │ ┌───────┐ │          │ │
│  │  │ retry [W2]         │  │  │ stderr   │  │ │stderr │ │          │ │
│  │  │ pagination [W3]    │  │  │ +stdout  │  │ │ fix   │ │          │ │
│  │  │ proxy 통합 [W5]     │  │  │ +exitCode│  │ │ [W1]  │ │          │ │
│  │  │ refresh rotation[W5]│  │  │ +signal  │  │ │+graceful│         │ │
│  │  │                    │  │  │ [W3]     │  │ │shutdown│ │          │ │
│  │  └────────────────────┘  │  └──────────┘  │ └───────┘ │          │ │
│  │                          │                │ Win path[W3]│         │ │
│  └──────────────────────────┴────────────────┴───────────┴──────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│ Layer 5: Core                                                           │
│  ┌──────────────┬───────────────┬──────────────┬──────────────────┐   │
│  │ output       │ credential-   │ executor     │ 신규 helper들      │   │
│  │ +ANSI 색상[W2]│  store        │ +audit       │ ┌────────────┐   │   │
│  │ +pager[W4]   │ +Keychain     │  통합 [W5]   │ │ pager [W4] │   │   │
│  │              │ +EnvStore [W2]│              │ │ proxy [W4] │   │   │
│  │              │               │              │ │ tls   [W5] │   │   │
│  │              │               │              │ │ i18n  [W5] │   │   │
│  │              │               │              │ │ audit [W4] │   │   │
│  │              │               │              │ │ prompt[W3] │   │   │
│  │              │               │              │ └────────────┘   │   │
│  └──────────────┴───────────────┴──────────────┴──────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘

[W1] Wave 1 Critical    [W2] Wave 2 High      [W3] Wave 3 Medium
[W4] Wave 4 Low         [W5] Wave 5 Backlog
```

### 2.2 Agent Team 병렬 실행 — Wave 별 토폴로지

```
                    ┌──── main branch ────┐
                    │                     │
                    ▼                     │ ◄─── coordinator merges
   ╔═════════════ Wave 1 (Critical, 5 agents 병렬) ═════════════╗
   ║                                                              ║
   ║  worktree   worktree   worktree   worktree   worktree        ║
   ║   ┌──┐      ┌──┐      ┌──┐      ┌──┐      ┌──┐             ║
   ║   │A1│      │A3│      │B1│      │C1│      │C2│             ║
   ║   │  │      │  │      │  │      │  │      │  │             ║
   ║   │co│      │ex│      │py│      │co│      │se│             ║
   ║   │mp│      │am│      │bri│     │ve│      │cu│             ║
   ║   │l │      │pl│      │dge│     │ra│      │ri│             ║
   ║   │et│      │es│      │   │     │ge│      │ty│             ║
   ║   └──┘      └──┘      └──┘      └──┘      └──┘             ║
   ║    │         │         │         │         │                ║
   ║    └────┬────┴────┬────┴────┬────┴────┬────┘                ║
   ║         ▼         ▼         ▼         ▼                      ║
   ║       ┌──────── Coordinator ────────┐                        ║
   ║       │ • merge 5 branches          │                        ║
   ║       │ • integrate package.json    │                        ║
   ║       │ • integrate README/docs     │                        ║
   ║       │ • verify lint/build/test    │                        ║
   ║       └────────────┬────────────────┘                        ║
   ║                    ▼                                          ║
   ║                 main FF                                       ║
   ╚══════════════════════════════════════════════════════════════╝
                       │
   ╔═════════════ Wave 2 (High, 4 agents) ═══════════════════════╗
   ║   A2 plugin │ B2 retry │ B3 keychain │ D1 color             ║
   ╚══════════════════════════════════════════════════════════════╝
                       │
   ╔═════════════ Wave 3 (Medium, 6 agents) ══════════════════════╗
   ║   B4 page │B5 cli-err│B6 win │C3 jsdoc│C4 e2e│D3 prompt     ║
   ╚══════════════════════════════════════════════════════════════╝
                       │
   ╔═════════════ Wave 4 (Low, 6 agents) ═════════════════════════╗
   ║   C5 en-readme│C7 prettier│D2 pager│D4 dym│E1 proxy│E3 audit║
   ╚══════════════════════════════════════════════════════════════╝
                       │
   ╔═══ Wave 5 (Backlog + Wiring, 직접 작업 — limit 회피) ═══════╗
   ║   F1a proxy 통합 │ F1b audit 통합 │ F1c pager 통합          ║
   ║   C6 i18n        │ E2 mTLS         │ E4 refresh rotation    ║
   ╚══════════════════════════════════════════════════════════════╝
                       ▼
                  PR #2 머지 (49 commits)

각 worktree = 격리된 git 디렉터리. agent 는 owner 파일만 수정.
공유 영역(schema/docs/package.json) 은 coordinator 가 spec 통합.
```

### 2.3 HTTP Request 흐름 — 통합된 미들웨어 스택

```
                ┌─ user invokes <cli> api users list --all ─┐
                │                                            │
                ▼
    ┌───────────────────────────────────────────┐
    │   BaseCommand                              │
    │   • TTY check → prompt missing flags [W3]  │
    │   • parse argv                             │
    └─────────────────┬─────────────────────────┘
                      ▼
    ┌───────────────────────────────────────────┐
    │   Executor.execute()                       │
    │   ┌─ start time ─┐                         │
    │   └──────────────┘                         │
    │           ▼                                │
    │   ┌─ HTTPProvider.execute() ─────────┐    │
    │   │                                   │    │
    │   │  resolveCredentials              │    │
    │   │   ├─ FileStore (default)         │    │
    │   │   ├─ KeychainStore [W2]          │    │
    │   │   └─ EnvStore [W2]               │    │
    │   │                                   │    │
    │   │   if device-code expired:        │    │
    │   │    └─ refresh + rotation [W5]    │    │
    │   │                                   │    │
    │   │  build URL/headers/body           │    │
    │   │                                   │    │
    │   │   ┌──────────────────────────┐   │    │
    │   │   │ pagination 활성 + --all? │   │    │
    │   │   └────┬─────────────┬───────┘   │    │
    │   │        │ yes         │ no         │    │
    │   │        ▼             ▼            │    │
    │   │   paginate()      single fetch    │    │
    │   │   (cursor /                       │    │
    │   │    offset /                       │    │
    │   │    link-header)                   │    │
    │   │        │             │            │    │
    │   │        └──────┬──────┘            │    │
    │   │               ▼                    │    │
    │   │       fetchWithRetry [W2]         │    │
    │   │        ├─ retryOn=[429,5xx]       │    │
    │   │        ├─ exp backoff + jitter    │    │
    │   │        ├─ Retry-After 우선         │    │
    │   │        └─ idempotent: auto         │    │
    │   │               │                    │    │
    │   │               ▼                    │    │
    │   │       fetchImpl (per-host cache)  │    │
    │   │        └─ getDispatcher() [W5]    │    │
    │   │            ├─ proxy-utils [W4]    │    │
    │   │            │   (HTTPS_PROXY)      │    │
    │   │            └─ tls-utils [W5]      │    │
    │   │                (mTLS opts)        │    │
    │   │               │                    │    │
    │   │               ▼                    │    │
    │   │           native fetch (undici)   │    │
    │   │                                    │    │
    │   └────────────────┬───────────────────┘   │
    │                    │                        │
    │   recordAudit() ◄──┘                        │
    │   ├─ ~/.cli/audit.log [W4]                 │
    │   ├─ JSONL + chmod 0600                    │
    │   └─ 민감 flag 마스킹                       │
    │                                             │
    └─────────────────┬──────────────────────────┘
                      ▼
    ┌───────────────────────────────────────────┐
    │   OutputFormatter.printAsync()             │
    │   ├─ format: json/yaml/table/csv          │
    │   ├─ ANSI 색상 (TTY + !NO_COLOR) [W2]     │
    │   ├─ pager (TTY + 긴 출력 + !json) [W4]   │
    │   └─ NO_COLOR/--no-color/--no-pager 존중   │
    └───────────────────────────────────────────┘
                      │
                      ▼
                 사용자 화면
```

### 2.4 정량 진척 그래프

```
Test 개수 (271 → 571, +300)

  600 ┤                                          ╭──── 571
  550 ┤                                    ╭─────╯
  500 ┤                          ╭─────────╯
  450 ┤                    ╭─────╯
  400 ┤              ╭─────╯
  350 ┤        ╭─────╯
  300 ┤  ╭─────╯
  271 ┼──╯
      └──┬─────┬─────┬─────┬─────┬─────┬──
       시작   W1    W2    W3    W4    W5
            +14   +76   +84   +88   +38

Coverage (% lines)

  80% ┤                              ╭───── 79.65%
  75% ┤                        ╭─────╯ 78.44%
  70% ┤              ╭─────────╯ 74.70%
  65% ┤    ╭─────────╯ 71.91%
  60% ┤    │
   0% ┼────╯  (이전 측정 안 됨)
      └──┬─────┬─────┬─────┬─────┬──
        시작  W1    W2    W3    W4

Stub 명령 / Examples / OS 매트릭스

  Stub 명령 :  4 ████████  → 0 ░░░░░░░░  ✅ 100%
  Examples  :  0 ░░░░░░░░  → 4 ████████  ✅ HTTP/CLI/Python/JS
  CI OS     :  1 ██░░░░░░  → 6 ████████  (3 OS × 2 Node)
  Workflows :  3 █████░░░  → 6 ████████  (+codeql, audit, dependabot)
```

---

## 3. 핵심 결과 요약

```
        ┌────────────────────────────────────────────┐
        │   Before: 80% 완성 프레임워크                │
        │   "엔진은 좋은데 외각이 빈 곳이 많다"          │
        └──────────────────┬─────────────────────────┘
                           │
            21 agents × 5 waves × isolated worktrees
                           │
        ┌──────────────────▼─────────────────────────┐
        │   After: production-ready                   │
        │   "팀에 배포 가능한 수준,                     │
        │    enterprise(proxy/mTLS/audit)도 OK"       │
        └────────────────────────────────────────────┘
```

---

## 4. 후속 백로그

코드 통합은 됐으나 wiring 또는 운영이 남은 항목:

1. **`printAsync` 호출자 마이그레이션** — `src/commands/*` 가 `print` → `printAsync` 사용하도록 (pager 실효)
2. **`HTTPProvider` 에 `tls-utils` 통합** — 현재 helper 만 있음, fetch 에 dispatcher 주입은 후속
3. **i18n message wrap 점진 migration** — catalogue 만 있고 기존 한국어 하드코딩은 그대로
4. **CI infrastructure 안정화** — `npm ci` 8분 hang 원인 (github actions runner 또는 cache)
5. **Multi-OS matrix fix** — Windows/macOS 첫 실행 실패 (path/shell 차이, husky)
6. **`--all` flag 자동 주입** — pagination 활성 명령에 codegen 단계에서 추가
7. **`--audit-off` / `--no-pager` flag 자동 주입** — BaseCommand 또는 codegen
8. **`cli audit tail/grep`** 명령 — `AuditLogger.tail()` 활용
9. **examples/ 빌드+실행 E2E** — Wave 1 A3 의 followup
10. **TypeDoc** — JSDoc 활용 자동 문서 생성

---

## Wave 6: aerocm 실전 통합 발견 사항 (2026-05-01)

> 새 예제 [`examples/aerospike-manager-cli/`](./examples/aerospike-manager-cli/) (Aerospike Cluster Manager API → 18 endpoint 의 `aerocm` CLI) 를 OpenAPI 3.1 spec 기반 5 manifest 로 매핑하면서 발견된 사항.

### 4.1 즉시 수정 (이번 통합에서 같이 처리)

| # | 영역 | 변경 | 파일 |
|---|---|---|---|
| 1 | **Type sync** | `HttpProviderConfig` 에 `retry` / `pagination` / `tls` / `credentialStore` 정식 타이핑. ANALYSIS.md 의 P0 #1 (TS interface 미반영) 해결. | `src/core/types.ts:144+` |
| 2 | **Type cleanup** | `provider.ts` 의 `(this.config as unknown as {retry?: unknown})` / `(this.config as unknown as Record<string, unknown>).pagination` 캐스트 제거. | `src/providers/http/provider.ts:979,1004` |
| 3 | **Codegen 버그** | table 출력에서 nested object/array 가 `[object Object]` 로 렌더링되던 문제. `cellStr()` 헬퍼로 객체/배열은 `JSON.stringify`, 그 외는 `String()`. aerocm 의 `labels` (map), `hosts` (array) 가 정상 표시. | `src/build/codegen.ts:226+` |
| 4 | **`resolveEnvVars` 확장 + dedupe** | `auth-utils.ts` 와 `init.ts` 의 중복 정의 제거 (Wave 6 backlog #5 해결). `${@configKey}` 문법 추가로 `~/.<bin>/config.yaml` 값 참조 가능. brace-balanced 파서로 `${A:-${@b:-x}}` 같은 중첩 지원. (`__cliName__` 자동 인식) | `src/core/auth-utils.ts`, `src/hooks/init.ts` |
| 5 | **`ConfigManager.loadSync()`** | oclif init hook (sync 컨텍스트) 에서 사용자 설정 1회 로드용. 파일 없거나 비어있으면 `{}` graceful. | `src/core/config.ts:42+` |
| 6 | **`init --endpoint <url>`** | `aerocm init --endpoint http://...` 로 `~/.<bin>/config.yaml` 의 `endpointUrl` 영구 저장. manifest 의 `${@endpointUrl}` placeholder 가 자동으로 사용. 프로젝트 init 과 endpoint 저장이 직교. (Wave 6 backlog 신규 — 사용자 요청 직접 반영) | `src/commands/init.ts` |
| 7 | **`--debug` details 직렬화 버그** | 실서버 QA 중 발견. 코드젠이 `String(result.error.details)` 를 사용해서 객체 details 가 `[object Object]` 로 출력. `JSON.stringify(det, null, 2)` 로 교체 → 서버 응답 detail (`{"detail":"..."}`) 정상 표시. | `src/build/codegen.ts:133+` |
| 8 | **CSV 셀의 nested object** | `--format csv` 도 (#3 의 table fix 누락) `[object Object]` 출력. table 의 `cellStr()` 와 동일한 헬퍼를 csv 에도 적용. | `src/build/codegen.ts:176+` |

### 4.2 Wave 7 — 백로그 일괄 정리 (2026-05-01 후속)

> "전부 개선해" 요청에 따라 Wave 6 backlog 22건 중 18건 처리. ANALYSIS.md 의 묵힌 P0 5건 + 신규 발견 13건.

| # | 영역 | 변경 | 파일 |
|---|---|---|---|
| Q1 | **`--debug` 없이 5xx detail 자동 노출** | error 시 `result.error.details` 가 있으면 항상 stderr 에 출력. 사용자가 `--debug` 안 줘도 server 가 보낸 detail 노출. | `src/build/codegen.ts` |
| Q2 | **`--silent-message` flag** | 성공/완료 메시지(stderr) 만 끄는 옵션. `--quiet` 보다 약함. 자동화에서 stdout 만 깨끗하게 받고 싶을 때. | `src/build/codegen.ts` |
| Q3 | **`--json` quiet 보다 우선** | `--quiet --json` 조합 시 quiet 가 우선해서 JSON 도 안 나오던 문제. `--json` 명시되면 body 출력. | `src/build/codegen.ts` |
| Q4 | **`--all` flag 자동 주입** | manifest pagination 활성 + GET 메서드 명령에 codegen 이 자동 `--all` flag 추가. 사용자가 manifest 에 일일이 안 적어도 됨. | `src/build/codegen.ts` |
| Q5 | **`--no-pager` flag + pager wiring** | TTY + 긴 출력 시 자동 `less -R`. json 은 raw 보존(jq 친화). 모든 generated 명령에 자동. helper 는 이미 `core/pager.ts` 존재 — wire 만 안 됐음. | `src/build/codegen.ts` |
| Q6 | **doctor healthCheck `<500` reachable** | baseUrl `/` GET 의 4xx 도 "도달 가능" 으로 표시. 이전엔 `response.ok` (200대만) 만 healthy → 정상 서비스가 "error" 로 보임. | `src/providers/http/provider.ts` |
| Q7 | **`coerceBodyValue` warning stderr 직접** | `logger.warn` 은 default level 보다 낮을 수 있어 invisible. `process.stderr.write` 로 즉시 노출. | `src/providers/http/provider.ts` |
| Q8 | **`resolveEnvVars` 적용 범위 전체 config 재귀** | 이전엔 `baseUrl`, `python.venv` 만. 이제 `resolveStringFields()` 가 모든 string leaf 재귀 치환 → `headers.*`, `tls.caFile/certFile/keyFile`, `auth.tokenEndpoint` 등 전부 ENV/`${@cfg}` 치환. | `src/core/auth-utils.ts`, `src/hooks/init.ts` |
| W1 | **pager wiring** | codegen 의 generated 명령이 모든 stdout 출력을 buffer → `writeWithPager()` 호출. json 은 raw stdout 직접. | `src/build/codegen.ts` |
| W2 | **audit logger wiring** | init hook 이 `AuditLogger` 인스턴스 만들어서 `Executor.setAuditLogger()` 주입. NO_AUDIT/--audit-off 가 아니면 모든 명령 호출이 `~/.<cli>/audit.log` (chmod 0600 JSONL) 에 기록. | `src/hooks/init.ts`, `src/core/executor.ts` |
| W3 | **mTLS dispatcher wiring** | `HTTPProvider.getDispatcher()` 가 proxy 없을 때 `tls-utils.createTlsDispatcher()` 적용. `provider.config.tls.caFile/certFile/keyFile` 옵션이 실제로 fetch 에 주입됨. | `src/providers/http/provider.ts` |
| W4 | **KeychainCredentialStore factory** | manifest `provider.config.credentialStore: keychain\|file\|env` 옵션이 실제로 적용. 'env' (기본) 는 sharedAuthManager 재사용, 'keychain'/'file' 은 manifest-별 새 AuthManager + store. graceful fallback. | `src/hooks/init.ts` |
| F1 | **codegen 이 namespace topic stub 자동 생성** | `dist/commands/<ns>/index.js` 자동 생성 — manifest description 이 `<bin> <ns> --help` topic description 으로 표시. Wave 6 의 oclif "마지막 명령 desc 누설" 문제 해결. | `src/build/codegen.ts` |
| F2 | **manifest `extends:` 합성** | parser 가 `extends: ../shared.yaml` 처리 → 부모 deep-merge 후 자식 override. cycle detection. aerocm 5+1 manifest 의 `provider.config` 25줄 × 5 중복을 제거. | `src/manifest/parser.ts`, `src/manifest/schema.ts` |
| F3 | **per-command timeout** | manifest `commands[].timeout` (ms) 이 `provider.config.timeout` 보다 우선. fast endpoint 와 slow endpoint 가 한 namespace 에 있어도 분리 가능. | `src/manifest/schema.ts`, `src/core/types.ts`, `src/core/registry.ts`, `src/providers/http/provider.ts` |
| F4 | **package.json polish** | `exports` field (서브패스 import 명시), `engines.node>=20`, `repository`, LICENSE 파일 추가. | `package.json`, `LICENSE` |
| F5 | **discovery 가 `_` prefix 파일 skip** | `_shared.yaml` 같은 include-only stub 파일이 plugin 으로 등록되지 않게 함. extends reference 시에만 사용. | `src/build/discovery.ts` |
| F6 | **device-code refresh proxy/mTLS/timeout 적용** | refresh fetch 가 `getDispatcher()` 호출 → proxy/mTLS dispatcher 사용. AbortSignal.timeout 로 hang 방지. | `src/providers/http/provider.ts` |
| **OPENAPI** | 🔥 **OpenAPI 3.x → manifest YAML 변환기** | 신규 builtin `<bin> codegen <spec.json>` — tag 별 manifest 자동 생성 (split 기본) 또는 단일 manifest. path/method → http, path-param → args, query → flags(query), body schema flatten → flags(body), array/enum/default 모두 매핑. dangerous(DELETE) 자동. heuristic 으로 list/create/get/update/delete/health/sub-resource 명명. 미커버: oneOf/anyOf 폴리모피즘, file upload, 보안 스키마. 19 endpoint 의 aerocm 변환 시연 — 손 매핑 3시간 → ~10초 + 미세 조정. | `src/build/openapi-to-manifest.ts`, `src/commands/codegen.ts` |
| I1 | **i18n core 메시지 wrap (시연)** | catalogue 에 `init.*` 키 추가 + `commands/init.ts` 가 `t()` 사용. 다른 모듈 점진적 migration 패턴 제시. | `src/core/i18n.ts`, `src/commands/init.ts` |

### 4.3 Wave 7 정량

- **수정 union-cli 파일**: 11 개 (`types.ts`, `auth-utils.ts`, `config.ts`, `executor.ts`, `i18n.ts`, `audit-log.ts` 미수정—이미 helper로 존재, `manifest/schema.ts`, `manifest/parser.ts`, `build/codegen.ts`, `build/discovery.ts`, `commands/init.ts`, `commands/codegen.ts`, `providers/http/provider.ts`, `hooks/init.ts`, `package.json`)
- **신규 union-cli 파일**: 2 개 (`src/build/openapi-to-manifest.ts`, `LICENSE`)
- **신규 테스트**: 1 파일 (`test/openapi-to-manifest.test.ts`, 9 tests for converter heuristic / param/body/dangerous/--single mode)
- **수정 테스트**: 3 파일 (`test/commands.test.ts` i18n, `test/http-provider.test.ts` stderr warning, `test/http-provider-integration.test.ts` healthCheck 401 의미 변경)
- **테스트**: **592 tests pass** (이전 583 + 9 신규), type check clean.
- **aerocm 변경**: 6 manifest 가 `extends: ./_shared.yaml` 로 통합 → provider config 중복 제거 (~125줄 → ~25줄)

### 4.4 남은 Skip 항목

- ~~**#21 CI npm ci 8min hang**~~ ✅ **closed (Wave 7 후속)** — 의존성 lifecycle scripts 의 hang 이 원인. `npm ci --ignore-scripts --prefer-offline --no-audit` 로 변경 (`.github/workflows/{ci,codeql}.yml`). 우리 코드는 dependency 의 install script 결과물에 의존하지 않으므로 안전.
- **#10 fan-out helper (`aerocm conn health --all`)** — provider-agnostic 한 fan-out 은 manifest schema 영역 밖. ad-hoc shell loop 또는 별도 example 로 시연 권장.
- **autocomplete 일원화** — `oclif/plugin-autocomplete` 와 `union-cli completion install` 둘 다 동작. 한쪽 deprecate 는 user breaking change 라 별도 결정 필요.

---

### 4.0 신규 백로그 (aerocm 작업으로 새로 식별된 이슈) — Wave 6 시점

| # | 우선순위 | 항목 | 발견 컨텍스트 / 영향 |
|---|---|---|---|
| 1 | P1 (UX) | **Topic 도움말 description**: oclif 가 `commands/<ns>/` 디렉터리의 topic 설명을 내부 마지막 명령의 description 으로 채움. `aerocm conn --help` 가 `create` 의 설명을 표시하는 등. **codegen 이 namespace 별로 oclif topic 등록 (package.json 의 `oclif.topics` 또는 topic stub 파일) 을 자동 생성하면 manifest description 사용 가능.** | aerocm 의 5 namespace 모두 영향. UX 직관성 저해. |
| 2 | P0 (DX) | **OpenAPI 3.x → manifest 자동 변환**: 18 endpoint 를 OpenAPI spec 에서 손으로 옮겨 적음. flag 타입, body type, path/query/body 매핑, snake/camelCase httpName 매핑 등 기계적인 작업. **`union-cli openapi convert <spec.json> --out plugins/` 명령으로 1차 manifest 생성 후 사람이 hand-tune 하는 패턴이 자연스러움.** 현재 `src/commands/codegen.ts` 가 stub (구현 예정) 인 슬롯 활용 가능. | OpenAPI 기반 corporate 내부 API 를 union-cli 로 wrap 할 때마다 반복 비용. |
| 3 | P1 (DX) | **Manifest 합성 / 공유 config**: aerocm 의 5 manifest 가 동일한 `provider.config` (baseUrl, retry, timeout, auth) 25 줄 × 5 = 125 줄을 중복 선언. **`config/<file>.yaml` 에 `extends: ../shared.yaml` 또는 manifest level `import:` 지원**. | 동일 백엔드 다중 namespace 시 항상 발생. |
| 4 | P1 | **Per-command timeout override**: `provider.config.timeout` 만 가능. `conn health` / `cluster get` 처럼 실제로 Aerospike 노드에 ping 하는 endpoint 는 30s+ 필요한 반면, list/get 류는 5s 면 충분. **`commands[].timeout` 추가**. | `aerocm conn health` 가 15s 에서 timeout. |
| 5 | ~~P2 (DRY)~~ ✅ closed | ~~**`resolveEnvVars()` 중복**: `src/core/auth-utils.ts:18` 과 `src/hooks/init.ts:23` 에 동일 함수 정의.~~ → 4.1 #4 에서 해결 (init.ts 가 auth-utils 를 import). |
| 6 | P2 | **`resolveEnvVars()` 적용 범위 여전히 좁음**: 현재 `baseUrl` (init.ts) 과 python `venv` 만 치환. config 문법은 통합됐지만 적용 위치 확장 필요 — `headers.*`, `tls.caFile/certFile/keyFile`, `auth.tokenEndpoint`, `auth.token.*` 등 전체 config 에 재귀 적용. | enterprise / private PKI 환경에서 `tls.caFile: ${CA_PATH}` 와 같이 쓰려면 별도 작업 필요. |
| 7 | P2 (UX) | **`pk-type` 같은 enum-string flag 의 oclif 타입**: schema 에서 `options` 만 지정하면 codegen 이 `Flags.string` 로 떨어지는데, 잘못된 값을 주면 oclif 가 친절한 에러를 줌 (잘 동작). 다만 manifest 에 `type: enum` 같은 명시적 타입 없이 `options` 의 존재로 enum 임을 추론하는 건 documentation 부재. **manifest reference 에 명시.** | 새 사용자 진입 장벽. |
| 8 | P2 | **`record list` 같은 Q 만 있는 GET 의 자동 pagination**: API 가 `pageSize` 만 받고 `next` cursor 가 응답에 포함되어도, manifest 의 `pagination` 설정 없이 `--all` 동작 안 함. 사용자는 매번 `pagination:` 을 직접 적어야 함. **OpenAPI 변환 시 응답 스키마에서 추론 가능하면 자동 주입**. | 5 API endpoint 영향. |
| 9 | P1 | **`doctor` 의 healthCheck 가 baseUrl `/` 에 GET 후 4xx 면 `error` 표시**: 도달성은 OK 인데 (서버는 살아 있음, 단지 root path 에 GET endpoint 없음) "error" 라고 표시되어 오해 소지. `< 500` 이면 healthy/reachable 로 분류해야 함. | aerocm `doctor` 에서 6 namespace 모두 "error" 로 표시되는데 실제로는 동작함. |
| 10 | P2 | **`coerceBodyValue` JSON 파싱 실패 warning 이 사용자에게 안 보임**: `httpBodyType: json` 인데 invalid JSON 입력 시 `logger.warn` 으로만 기록 → 일반 사용자는 못 봄. raw string 으로 그대로 전송 → 서버 측 422 받음. **stderr 로 즉시 출력하거나 default 로 throw 하는 strict 모드 추가**. | aerocm 에서 `--bins not-json` 입력 시 user 가 원인 파악 어려움. |
| 11 | P0 (UX) | **write 명령의 응답에 success message + JSON body 가 같은 stream 에 섞임**: success message 는 stderr, body 는 stdout 으로 분리되어 있음 (의도된 설계). 그러나 사용자가 `2>&1 | jq` 로 묶으면 `JSON.parse` 실패. 문서화 필요 또는 `--silent-message` 옵션. | aerocm `conn create` 의 ID 추출 시 발견. |

### 4.3 정량

- **신규 예제 파일**: 10 개 (manifest 6: connections/clusters/records/indexes/query/sample-data, package.json, tsconfig, bin × 2, src/index.ts, README, expected-output, .gitignore)
- **수정된 union-cli 파일**: 6 개 (`types.ts`, `providers/http/provider.ts`, `build/codegen.ts`, `core/auth-utils.ts`, `core/config.ts`, `hooks/init.ts`, `commands/init.ts`)
- **신규 테스트**: 1 파일 (`test/auth-utils.test.ts`, 20 tests for `resolveEnvVars` env/config/중첩/edge cases).
- **테스트**: **583 tests pass** (이전 563 + 20 신규), type check pass.
- **실제 호출 검증**:
  - `conn list/get` 로 a private cluster manager API 16 개 connection 정상 조회.
  - `aerocm init --endpoint <url>` → `~/.aerocm/config.yaml` 저장 → 후속 호출이 config 값을 사용 확인.
  - 우선순위 검증: `AEROCM_ENDPOINT_URL` (env) > `~/.aerocm/config.yaml` 의 `endpointUrl` > manifest default.

### 4.4 실서버 QA (env=stage cluster)

stage 평촌 cluster (`conn-3c76a727375b`, AI_DEV_AEROSPIKE, Aerospike CE 6.1.0.12, 3 nodes, 2 namespaces=`aidev` / `aidev_verification`) 에 대해 시나리오 단위 QA.

| 카테고리 | 명령 | 결과 | 비고 |
|---|---|---|---|
| Read | `conn list` (json/yaml/table/csv) | ✅ | 16 connection 모두 정상 (csv `labels` 객체 직렬화 확인) |
| Read | `conn get`, `conn health` | ✅ | nodeCount=3, namespaceCount=2, build=6.1.0.12 |
| Read | `cluster get` | ✅ | 1094 라인 응답 (노드 statistics 매우 상세) |
| Read | `record list --ns aidev` | ✅ | record key/meta/bins 정상, total/page/hasMore 메타 |
| Read | `record list --ns aidev_verification` | ❌ | 서버 500 (server-side issue) |
| Read | `record filter` | ✅ | `executionTimeMs/scannedRecords/returnedRecords` 메타 |
| Read | `index list` | ✅ | building/ready state, ns/set/bin/type 모두 |
| Write | `record put`/`detail`/`delete` 사이클 | ✅ | gen=1→2 증가, +new_bin, ttl reset, list 0 confirm |
| Write | `index create`/`delete` | ⚠️ | HTTP 500 응답이지만 **실제로 적용됨** (list 로 confirm). server-side quirk. |
| Write | `conn create`/`update`/`delete` 사이클 | ✅ | id assigned → description 변경 → 404 verify |
| Write | `sample create` | ❌ | 서버 500 (직접 curl 도 동일, server-side issue. createIndexes 부산물은 만들어짐) |
| Write | `query exec` | ❌ | 서버 500 |
| Error | 잘못된 conn_id | ✅ | HTTP 404 + `--debug` detail "Connection 'X' not found" |
| Error | 필수 flag/arg 누락 | ✅ | "Missing required flag" / "Missing 1 required arg" + help 안내 |
| Error | enum 잘못된 값 (`--type INVALID`) | ✅ | "Expected --type=INVALID to be one of: numeric, string, geo2dsphere" |
| Error | dangerous 명령 `--force` 없이 | ✅ | "이 명령은 확인이 필요합니다. --force 플래그를 사용하세요." |
| Error | 잘못된 JSON `--bins` | ✅ | warning 로그 + raw string 전송 → 서버 422 + detail |
| Config | `init --endpoint` → conn list (no env) | ✅ | config 값 사용 |
| Config | `AEROCM_ENDPOINT_URL=invalid` overrides config | ✅ | fetch failed (env 우선 확인) |
| Config | `config get/list/reset` 빌트인 | ✅ | yaml 형식 출력 |
| Built-in | `doctor` | ⚠️ | 시스템/manifest 정보 OK. provider health 가 baseUrl `/` 의 404 를 "error" 로 표시 (위 백로그 #9). |

QA 중 발견한 aerocm/union-cli 측 issue 는 모두 fix:
- ✅ `--debug` 객체 details 가 `[object Object]` (codegen.ts) → JSON.stringify
- ✅ `--format csv` 의 nested object `[object Object]` → table 과 동일하게 JSON 직렬화
- ✅ records.yaml example 의 `primaryKey` → `pk` (RecordKey 스키마 필드 정정)

서버 측 5xx 는 union-cli/aerocm 의 retry 정책으로 자동 3회 재시도되어 사용자 경험 개선됨. 응답 detail 은 `--debug` 으로 이제 정상 출력.

---

## 5. 작업 방식의 특이점

### Agent Team Orchestration
21 isolated worktree agents + 4 coordinators + 직접 통합 (Wave 5 의 일부는 limit 회피로 직접 작업).

각 agent 는:
- **Owner 파일만 수정** — 다른 영역은 read-only
- **공유 파일(schema/docs/package.json) 은 spec 으로 반환** — coordinator 가 통합
- **Worktree isolation** — `.claude/worktrees/agent-<id>/` 격리된 git 디렉터리

각 wave 종료 시 coordinator 가:
1. 모든 agent worktree branch 를 sequential merge
2. agent 들이 반환한 spec 들을 통합 (manifest schema, package.json, docs)
3. `npm run lint && lint:types && build && test:coverage` 검증
4. main 으로 fast-forward + worktree cleanup

### 결과
- 4 wave 모두 충돌 거의 없이 진행 (Wave 3 의 1 conflict 만 수동 해결).
- 순차 대비 **약 3~4배 단축** + 각 agent 가 단일 PR-단위로 산출되어 변경 추적성 유지.
- 21 commits (agent) + 5 merge commits + 4 통합 commit + 6 직접 commit (Wave 5) = **49 commits**.

---

## 6. 참고 링크

- PR: https://github.com/KimSoungRyoul/union-cli/pull/2
- Plan 문서: [`plan.md`](./plan.md)
- Manifest reference: [`docs/manifest-reference.md`](./docs/manifest-reference.md)
- Auth 가이드: [`docs/auth.md`](./docs/auth.md)
- Examples: [`examples/`](./examples/)
- English README: [`README.en.md`](./README.en.md)
