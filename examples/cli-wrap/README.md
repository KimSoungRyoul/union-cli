# cli-wrap

> union-cli **CLI provider** 데모 — `git` 바이너리를 한 장의 YAML 로 통합 CLI 커맨드로 wrapping.

## 무엇을 보여주는가

- `provider.type: cli` 로 외부 바이너리를 spawn 하여 통합 CLI 에 흡수
- `cli.template` 으로 서브커맨드 / 인자 / 플래그 구성 (`{argName}` 치환 지원)
- `outputParser: lines` 로 stdout 을 줄 단위 배열로 파싱 → `--json` 출력 자동 변환
- `cliMap` 으로 union-cli flag → 외부 바이너리 flag 매핑 (`--all` → `git branch --all`)
- ASCII namespace (`git`) 를 사용하지만, namespace 자체는 `^[a-z][a-z0-9-]*$` 패턴이면 무엇이든 가능 (다국어 별칭은 shell alias 로 추가)

## Prerequisites

- Node.js 18 이상
- `git` 바이너리가 PATH 에 있어야 함 (`git --version` 확인)
- 이 디렉터리는 git 저장소 안에서 실행해야 의미 있는 출력이 나옵니다 (예: `examples/cli-wrap` 자체)

## 빌드 & 실행

```bash
# 1. 의존성 설치
npm install

# 2. YAML manifest 에서 oclif 커맨드 코드 생성
npm run build
# -> 4 commands generated

# 3. 실행
npx gw --help
npx gw git status show
npx gw git log recent 5
npx gw git diff stat
npx gw git branch list --all --json
```

개발 모드:

```bash
./bin/dev.js git status show --json
```

## Expected Output

[expected-output.txt](./expected-output.txt) 참고. 출력은 현재 git 저장소 상태에 따라 다릅니다.

```bash
$ npx gw git log recent 3 --json
[
  "9cdc67a fix(docs): drop enablement: true (...)",
  "39a409d fix(docs): bump pages actions to latest (...)",
  "f7c46e5 fix(docs): upgrade Docusaurus 3.7 -> 3.10 (...)"
]
```

## YAML Manifest

[plugins/git.yaml](./plugins/git.yaml) — `outputParser: lines` 가 핵심입니다. 다른 옵션 (`json` / `csv` / `yaml` / `table`) 은 [docs/manifest-reference.md](../../docs/manifest-reference.md#outputparser) 참고.

## 참고

- CLI provider 는 spawn 기반이므로 셸 인젝션이 발생하지 않습니다. 사용자 입력은 항상 단일 인자로 전달됩니다.
- 다국어 namespace (예: `깃`) 가 필요하면 namespace 는 ASCII 로 두고, shell alias 로 wrapping 하세요.
- manifest 검증 (Wave 3 E2E) 에서 4종 example 모두 빌드 + smoke test 가 자동화될 예정입니다.
