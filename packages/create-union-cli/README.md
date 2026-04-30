# create-union-cli

union-cli 프로젝트를 생성하는 scaffolding 도구입니다.

## 사용법

```bash
npm create union-cli my-app
# 또는
npx create-union-cli my-app
```

현재 디렉토리에 생성:

```bash
npx create-union-cli .
```

## 생성되는 프로젝트 구조

```
my-app/
├── README.md
├── package.json
├── tsconfig.json
├── bin/
│   ├── run.js
│   └── dev.js
├── src/
│   └── index.ts
├── plugins/
│   └── example-api.yaml
└── .gitignore
```

## 생성 후

```bash
cd my-app

# YAML manifest 수정
vim plugins/example-api.yaml

# 빌드
npm run build

# 실행
npx my-app --help
npx my-app api posts list --json
```
