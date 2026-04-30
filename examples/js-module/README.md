# js-module

> union-cli **JS provider** 데모 — 로컬 ESM 모듈을 in-process 로 호출.

## 무엇을 보여주는가

- `provider.type: js` 로 로컬 Node.js 모듈을 import 하여 직접 호출 (별도 프로세스 없음 → 가장 빠름)
- TypeScript 소스를 `tsc` 로 빌드한 후, 빌드 산출물 (`./dist/calc.js`) 을 manifest 의 `module:` 로 참조
- `httpBodyType: number-array` 로 `"1,2,3"` 입력을 `[1,2,3]` 로 자동 파싱
- 함수 시그니처: `(args: {a, b, numbers, ...}) => Result` — args 와 flags 가 단일 객체로 병합되어 전달됨

## Prerequisites

- Node.js 18 이상

## 빌드 & 실행

```bash
# 1. 의존성 설치
npm install

# 2. TypeScript 빌드 (src/calc.ts -> dist/calc.js) + manifest 빌드 (commands)
npm run build
# -> tsc + 3 commands generated

# 또는 단계별 실행:
#   npm run build:ts        # TypeScript 만 빌드
#   npm run build:manifest  # manifest 만 빌드

# 3. 실행
npx calc --help
npx calc calc math add --a 2 --b 3 --json
npx calc calc math multiply --a 4 --b 5 --json
npx calc calc math sum --numbers 1,2,3,4,5 --json
```

> 개발 모드 (`./bin/dev.js`) 를 쓰더라도 JS provider 는 `dist/calc.js` 를 import 하므로 **TypeScript 빌드 (`npm run build:ts`) 는 반드시 한 번 실행**해야 합니다.

## Expected Output

```bash
$ npx calc calc math add --a 2 --b 3 --json
5

$ npx calc calc math sum --numbers 1,2,3,4,5 --json
15
```

전체 출력은 [expected-output.txt](./expected-output.txt) 참고.

## 구조

```
js-module/
  src/
    index.ts          # oclif entry point
    calc.ts           # add, multiply, sum 함수 (export)
  plugins/
    calc.yaml         # union-cli manifest
  package.json        # union-cli 의존성 (file:../..)
```

## JS Provider 호출 규약

JS provider 는 다음 시그니처를 기대합니다:

```ts
export function functionName(args: Record<string, unknown>): unknown | Promise<unknown>
```

- `args` 객체는 manifest 의 `args:` (위치 인자) 와 `flags:` (옵션) 를 병합한 단일 객체입니다.
- 동기 / 비동기(Promise) 모두 지원됩니다.
- 반환값이 직접 union-cli 의 출력 데이터가 됩니다 (`--json` / `--format yaml` 자동 변환).

## 참고

- JS provider 구현: [src/providers/js/](../../src/providers/js/)
- 외부 npm 패키지를 사용하려면 manifest 의 `module:` 를 패키지 이름 (`"my-sdk"`) 로 지정하면 됩니다.
- manifest 검증 (Wave 3 E2E) 에서 4종 example 모두 빌드 + smoke test 가 자동화될 예정입니다.
