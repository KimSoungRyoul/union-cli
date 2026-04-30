# union-cli 깊이 분석 보고서 (2차 라운드)

> 작성: 2026-05-01
> 시점: 5 waves / 49 commits / PR #2 머지 직후
> 방법: 4개 Explore agent 가 병렬 비판적 분석 (코드 통합 / 테스트 품질 / 운영·보안 / Vision·확장성)

---

## 🚨 Executive Summary

**표면**: 27 files / 571 tests / 79.65% coverage / 49 commits — production-ready 처럼 보임.

**깊이**: **5 waves 의 신규 helper 중 4개 (pager / audit / tls / i18n) 가 사실상 죽은 코드** 상태.

| 지표 | 표면 점수 | 깊이 점수 | Δ |
|---|---|---|---|
| 통합 완성도 | 100% (코드 머지) | **~50%** (실제 wiring) | ▼ 50%p |
| 테스트 신뢰도 | 79.65% line | **6.5/10** (mock 깊이 부족) | ▼ 14%p |
| 보안 깊이 | "잘됨" | **3/10** | ▼ 50%p |
| 운영 준비도 | "MVP 완성" | **3/10** (publish 차단 다수) | ▼ 50%p |
| Vision alignment | "5 waves 완료" | **5/10** (Provider 불균형 + schema versioning 부재) | ▼ 30%p |

---

## 🔴 Critical — 즉시 조치 필요 (P0)

### 1. 신규 helper 5개 중 4개가 미통합 (죽은 코드)

| 모듈 | 통합도 | 증거 |
|---|---|---|
| **pager** (Wave 4 D2) | **5%** | `OutputFormatter.printAsync()` 정의됨, `src/commands/*` 에서 호출 0 |
| **audit-log** (Wave 4 E3) | **0%** | `Executor.auditLogger` 옵션, but `src/hooks/init.ts:17` `new Executor()` 가 빈 인자 |
| **tls-utils** (Wave 5 E2) | **0%** | `createTlsDispatcher` import 한 파일 0개 |
| **i18n** (Wave 5 C6) | **10%** | `t()` 호출 0, 모든 메시지가 한국어 하드코딩 그대로 |
| **proxy-utils** (Wave 4 E1 + Wave 5 F1a) | **75%** | execute/healthCheck 는 wire ✅, device-code refresh fetch 는 dispatcher 미적용 |
| **prompt** (Wave 3 D3) | **85%** | base-command 에 wire ✅, TTY 감지 robustness 미검증 |

→ 5 waves 의 코드는 머지됐으나 사용자가 실제로 체감하는 기능은 **proxy/prompt 만**.

### 2. `KeychainCredentialStore` 미사용
- `getRecommendedStore()` factory 호출 0회
- `src/hooks/init.ts:20` 에서 `new EnvCredentialStore()` 하드코딩
- macOS Keychain / Linux secret-tool / Windows cmdkey 모두 코드만 있고 동작 안 함

### 3. `codegen` 명령 stub (이전 분석에서 놓침)
- `src/commands/codegen.ts:12`: `"(구현 예정)"` 출력만
- README/plan.md 에는 있는 것처럼 광고됨

### 4. Production publish 차단
- `package.json` `exports` 필드 부재 (ESM dual-mode 호환 불가)
- LICENSE 파일 누락 (package.json 만 "MIT")
- `engines.node >= 18.0.0` — Node 18 EOL (2025-04) 지났는데 갱신 안 됨

### 5. CI 실패 채로 admin merge
- ubuntu/macos/windows 모두 `npm ci 8분 hang` 으로 fail
- 첫 npm publish 시도 시 동일 실패 가능성
- 49 commits 중 일부는 다중 OS 에서 검증 안 됨

---

## 🟠 High — 단기 (P1)

### 6. 타입 안전성 갭 — `HttpProviderConfig` 미갱신

```ts
// src/core/types.ts — 이대로
export interface HttpProviderConfig {
  baseUrl: string
  auth?: AuthConfig
  headers?: Record<string, string>
  timeout?: number
  // ❌ retry / pagination / credentialStore / tls 모두 누락
}

// src/providers/http/provider.ts:979 — 이런 식으로 사용 중
const retryRaw = (this.config as unknown as {retry?: unknown}).retry
```
→ AJV runtime 검증과 TypeScript compile 검증 사이 일관성 깨짐. IDE 자동완성 안 됨, 리팩토링 위험.

### 7. Device-code token refresh 가 retry/proxy 모두 미보호
- `provider.ts:842` — `await fetch(...)` 직접 호출 (fetchWithRetry 미사용, getDispatcher 미주입)
- 토큰 refresh 가 HTTP proxy 환경에서 실패할 가능성

### 8. Chromium 쿠키 무단 추출 (보안)
- `token-store.ts:decryptChromeCookies()` — 사용자 인터랙션 없이 Chrome/Brave/Edge 의 Safe Storage 키를 macOS Keychain 에서 추출, 다른 앱의 쿠키를 권한 prompt 없이 복호화
- CWE-522 (Insufficiently Protected Credentials)
- 정당한 시나리오 (cookie auth) 인지 의도가 모호 — 명시적 `--allow-cookie-extraction` flag 필요

### 9. Windows 보안 저장소 사실상 평문
- `cmdkey` 가 password 회수 불가 → sidecar 파일 (`%APPDATA%/<cli>/keychain-fallback/<ns>.json`) 평문 저장
- chmod 못 함 (NTFS), ACL 적용 코드 없음
- `keytar` (DPAPI 기반) 도입 또는 PowerShell `Export-Clixml` 필요

### 10. 테스트 mock 이 production path 우회
- `KeychainCredentialStore` 테스트: `vi.doMock('node:child_process')` 로 `execFileSync` 차단 → 실제 `security` / `secret-tool` 호출 검증 0
- `python-bridge-path.test.ts`: `node:fs` mock — 실제 Python subprocess 0
- pager/tls/proxy 테스트도 동일 패턴
- coverage 79.65% 는 "선언 라인" 기준, 실제 OS 동작은 미검증

---

## 🟡 Medium — 분기 단위 (P2)

### 11. 테스트 커버리지 불균등 분포

| 파일 | Line coverage | 위험 |
|---|---|---|
| `src/commands/auth/login.ts` (186줄) | **46.8%** | 크리티컬 인증 로직 절반 미테스트 |
| `src/build/discovery.ts` | **28.1%** | plugin 발견 로직 거의 미검증 |
| `src/build/codegen.ts` | 56.1% | 생성된 oclif 파일 syntax 검증 부재 |
| `src/hooks/init.ts` | ? | 동적 등록 timing 미검증 |

### 12. Pagination edge case 누락
- itemsPath 가 array 가 아닐 때 (string/null) 처리 미테스트
- nextPath null vs undefined vs ""
- maxPages=1 즉시 종료 case
- POST + idempotent: 'auto' 가 retry 안 하는지 검증 부재

### 13. 동시성 제어 부재
- `audit.log` 다중 프로세스 write — Windows 에서 race
- `credentials/<ns>.json` TOCTOU 취약 (mkdir + write + chmod)
- `plugins.json` 동시 add 시 corruption 가능

### 14. Audit log 정제 미흡
- `error` 필드에 사용자 입력 ANSI escape 가 들어가면 `cat audit.log` 시 터미널 제어 (CWE-117)
- request body 안의 password 필드는 마스킹 안 됨 (flags 만 마스킹)

### 15. 의존성 갱신 부재
- undici 6.21 (현재 8.1+) — 2년 차이
- vitest 3.1 (현재 4.x)
- 신규 프로젝트치고 outdated

---

## 🟢 1차 분석 후 새로 발견된 백로그 (이전 plan 에 없음)

### A. Manifest schema versioning ← 1.0 블로커
- 현재 `additionalProperties: true` (자유) + `manifestVersion` 필드 예약만 됨, 사용 0
- v1 → v2 마이그레이션 경로 부재
- Helm 처럼 `apiVersion: v1` 강제 + migration guide 필수

### B. Plugin 시스템 = manifest 배포 메커니즘만
- `plugin add <pkg>` 가 단지 manifest 파일을 등록하는 행위
- 사용자가 새 provider type (e.g., GraphQL/gRPC) 추가는 fork 필요
- 진짜 plugin SDK (IPC-based dynamic loading) 부재

### C. Provider 1급 시민 불균형

| Provider | LOC | retry | auth | streaming |
|---|---|---|---|---|
| HTTP | 1,080 | ✅ | 5종 | ❌ |
| CLI | 251 | ❌ | ❌ | ❌ |
| Python | 116 | ❌ | ❌ | ❌ (sync RPC만) |
| JS | 68 | ❌ | ❌ | ❌ |

→ HTTP 가 절대 우위 → "통합" vision 위반

### D. REST-only 시나리오 한계
- multipart/form-data 파일 업로드 → 코드 필요
- binary stream 다운로드 → 미지원
- WebSocket / SSE / GraphQL / gRPC → 미지원
- 응답 후처리 (jq-like transform) → 미지원
- 명령 chaining → 미지원

### E. DX/운영 도구 부재
1. `<cli> manifest validate` — 빌드 전 검증 명령
2. `<cli> upgrade` — self-update
3. `<cli> alias create` — 명령 alias
4. `<cli> history` — 호출 이력 조회 (audit-log tail)
5. Codegen TypeScript types — manifest → typed client
6. JSON Schema export → VSCode YAML autocomplete
7. Mock server / recording — 오프라인 테스트
8. Telemetry opt-in — 사용 통계
9. Update notifier — 새 버전 알림
10. doctor --verbose — 네트워크/keystore 진단

---

## 📊 정량 진단 매트릭스

```
                  Wave 5 후 표면     실제 깊이        Δ
통합 완성도       ███████████ 100%   ██████░░░░ 50%   ▼ 50%p
테스트 신뢰도     ████████░░  79.65% ██████░░░░ 65%   ▼ 14%p
보안 깊이         ████████░░  잘됨   ███░░░░░░░ 30%   ▼ 50%p
운영 준비도       ████████░░  좋음   ███░░░░░░░ 30%   ▼ 50%p
Vision alignment  ████████░░  도달   █████░░░░░ 50%   ▼ 30%p
```

---

## 🎯 우선순위 추천 (Wave 6 후보)

### Wave 6a (P0 — 즉시, 1주)

- [ ] `printAsync` 호출자 마이그레이션 (`commands/*` 가 사용) [pager 살리기]
- [ ] `src/hooks/init.ts` 에서 `AuditLogger` + `KeychainStore` 주입 [audit + keychain 살리기]
- [ ] `codegen` 명령 실구현 또는 README 에서 제거 [거짓 광고 제거]
- [ ] `HttpProviderConfig` 타입에 `retry`/`pagination`/`credentialStore`/`tls` 추가 [타입 안전성]
- [ ] device-code refresh 에 `fetchWithRetry` + `getDispatcher` 적용 [proxy 미보호 수정]
- [ ] `package.json` `exports` + LICENSE 파일 + Node 20+ 명시 [npm publish 준비]

### Wave 6b (P1 — 단기, 1~2주)

- [ ] `tls-utils` 통합 (`provider.ts` 의 `fetchImpl` 에 dispatcher 주입)
- [ ] `i18n` `t()` 점진 wrap (`commands/*` 부터)
- [ ] Chromium 쿠키 추출 시 명시적 동의 prompt 또는 flag
- [ ] Windows `keytar` 도입 (sidecar 평문 제거)
- [ ] CI `npm ci hang` 진단 + Windows/macOS matrix fix
- [ ] 동시성 락 (`audit.log` / `plugins.json` / `credentials`)
- [ ] 의존성 갱신 (undici 6 → 8, vitest 3 → 4)

### Wave 6c (P2 — 분기, 1.0 준비)

- [ ] Manifest schema v1 freeze + `manifestVersion` 필수화
- [ ] `auth/login` + `discovery` 커버리지 80% 이상으로 보강
- [ ] E2E 에 `dist/` 산출물 검증 + 실제 manifest 빌드/실행
- [ ] Pagination edge case 테스트 보강
- [ ] Plugin SDK 설계 — IPC 기반 dynamic provider 등록
- [ ] Provider 1급 시민화 — CLI/Python/JS 에도 retry/auth 추가
- [ ] multipart/form-data + binary stream HTTP provider
- [ ] `doctor --verbose` / `<cli> manifest validate` / `<cli> upgrade`

---

## 💎 한 줄 결론

```
   Wave 1~5: "코드는 만들었다"  → 머지 49 commits
   실제 상태: "절반은 connect 가 안 되어 있다"
                 ↓
   진짜 1.0 까지: 코드 추가가 아니라 wiring + 검증 작업이 더 중요
```

**가장 큰 single decision (1.0 블로커)**:

> **Manifest schema versioning 전략을 지금 정해야 한다.**
>
> 현재 `additionalProperties: true` 로 모든 필드를 허용하면 v0.x → v1.0 갈 때 backward compat 비용 폭발.

---

## 📎 참고

- [`IMPROVEMENTS.md`](./IMPROVEMENTS.md) — Wave 1~5 작업 종합 보고
- [`plan.md`](./plan.md) — 프레임워크 설계 계획
- PR #2: https://github.com/KimSoungRyoul/union-cli/pull/2 (머지됨)
