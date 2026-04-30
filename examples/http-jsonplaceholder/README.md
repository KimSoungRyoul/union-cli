# http-jsonplaceholder

> union-cli **HTTP provider** 데모 — [JSONPlaceholder](https://jsonplaceholder.typicode.com/) 무료 fake REST API 를 한 장의 YAML 로 CLI 화.

## 무엇을 보여주는가

- `provider.type: http` 한 줄로 외부 REST API 를 CLI 커맨드로 변환
- GET (목록/상세), POST (생성) 의 표준 사용 패턴
- query string 매핑 (`httpMap: query`), path parameter (`{id}`), body 매핑 (`httpMap: body`)
- `--json` / `--format yaml` / `--format csv` 등 표준 출력 포맷 자동 지원

## Prerequisites

- Node.js 18 이상
- 인터넷 연결 (`https://jsonplaceholder.typicode.com` 도달 가능)

## 빌드 & 실행

```bash
# 1. 의존성 설치 (union-cli 는 file:../.. 로 로컬 참조)
npm install

# 2. YAML manifest 에서 oclif 커맨드 코드 생성
npm run build
# -> 3 commands generated

# 3. 실행
npx jp --help
npx jp api posts list --json
npx jp api posts get 1 --json
npx jp api posts list --userId 1 --json
npx jp api posts create --title "Hello" --body "World" --json
```

개발 모드 (빌드 없이 tsx 로 즉시 실행):

```bash
./bin/dev.js api posts list --json
```

## Expected Output

전체 출력 스냅샷은 [expected-output.txt](./expected-output.txt) 참고.

```bash
$ npx jp api posts get 1 --json
{
  "userId": 1,
  "id": 1,
  "title": "sunt aut facere repellat provident occaecati excepturi optio reprehenderit",
  "body": "quia et suscipit\nsuscipit recusandae ..."
}
```

## YAML Manifest

[plugins/api.yaml](./plugins/api.yaml) 한 장이 전부입니다. 커맨드를 추가하려면 `commands:` 배열에 항목을 추가하고 `npm run build` 만 다시 실행하세요.

## 참고

- 매니페스트 schema: [docs/manifest-reference.md](../../docs/manifest-reference.md)
- 인증이 필요한 실제 API 는 `auth.type: bearer` / `jwt` / `cookie` 등으로 변경하세요. 자세한 내용은 루트 [README.md](../../README.md) 의 인증 섹션 참고.
- manifest 검증 (Wave 3 E2E) 에서 4종 example 모두 빌드 + smoke test 가 자동화될 예정입니다.
