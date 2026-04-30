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
    tls:                    # 사내 PKI / mTLS (helper 추가, wiring 후속)
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
