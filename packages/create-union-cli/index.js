#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';

const VERSION = '0.1.0';

// ── ANSI Colors ──

const noColor = process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb';
const fmt = {
  bold:   (s) => (noColor ? s : `\x1b[1m${s}\x1b[0m`),
  green:  (s) => (noColor ? s : `\x1b[32m${s}\x1b[0m`),
  cyan:   (s) => (noColor ? s : `\x1b[36m${s}\x1b[0m`),
  yellow: (s) => (noColor ? s : `\x1b[33m${s}\x1b[0m`),
  red:    (s) => (noColor ? s : `\x1b[31m${s}\x1b[0m`),
  dim:    (s) => (noColor ? s : `\x1b[2m${s}\x1b[0m`),
};

// ── Prompt ──

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    }),
  );
}

// ── Validation ──

function validateProjectName(name) {
  if (!name) return { valid: false, error: 'Project name is required.' };
  if (name.length > 214) return { valid: false, error: 'Name must be 214 characters or fewer.' };
  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
    return { valid: false, error: 'Name must be a valid npm package name (lowercase, no spaces).' };
  }
  return { valid: true };
}

function toKebabCase(name) {
  return name.replace(/@[^/]+\//, '').replace(/[^a-z0-9-]/g, '-');
}

// ── Templates ──

function packageJsonTpl(projectName, cliName) {
  return JSON.stringify(
    {
      name: projectName,
      version: '0.1.0',
      description: `${cliName} — union-cli 기반 통합 CLI`,
      type: 'module',
      bin: { [cliName]: './bin/run.js' },
      scripts: {
        build:
          'node --input-type=module -e "import {build} from \'union-cli/dist/build/builder.js\'; const r = await build({projectDir:\'.\', codegen:true, commandsDir:\'./dist/commands\'}); console.log(r.generatedFiles.length+\' commands generated\');"',
        dev: './bin/dev.js',
      },
      oclif: {
        bin: cliName,
        dirname: cliName,
        commands: { strategy: 'pattern', target: './dist/commands' },
        plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete', 'union-cli'],
        topicSeparator: ' ',
      },
      dependencies: {
        '@oclif/core': '^4.2.8',
        '@oclif/plugin-autocomplete': '^3.2.45',
        '@oclif/plugin-help': '^6.2.27',
        ajv: '^8.17.1',
        'union-cli': '^0.1.0',
        yaml: '^2.7.1',
      },
      devDependencies: {
        oclif: '^4.17.38',
        tsx: '^4.19.4',
        typescript: '^5.7.3',
      },
      engines: { node: '>=18.0.0' },
    },
    null,
    2,
  ) + '\n';
}

function binRunTpl() {
  return `#!/usr/bin/env node

import {execute} from '@oclif/core'

await execute({dir: import.meta.url})
`;
}

function binDevTpl() {
  return `#!/usr/bin/env -S npx tsx

import {execute} from '@oclif/core'

await execute({development: true, dir: import.meta.url})
`;
}

function tsconfigTpl() {
  return JSON.stringify(
    {
      compilerOptions: {
        declaration: true,
        module: 'Node16',
        moduleResolution: 'Node16',
        outDir: 'dist',
        rootDir: 'src',
        strict: true,
        target: 'ES2022',
        sourceMap: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        skipLibCheck: true,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  ) + '\n';
}

function srcIndexTpl() {
  return `export {run} from '@oclif/core'\n`;
}

function exampleManifestTpl(cliName) {
  return `# plugins/example-api.yaml
# JSONPlaceholder API 예제 — 수정하거나 삭제하고 직접 manifest를 작성하세요
name: example-api
namespace: api
description: "Example HTTP API (JSONPlaceholder)"

provider:
  type: http
  config:
    baseUrl: "https://jsonplaceholder.typicode.com"
    auth:
      type: none
    timeout: 10000

commands:
  - id: posts:list
    description: "List posts"
    http:
      method: GET
      path: "/posts"
    flags:
      - name: userId
        type: number
        description: "Filter by user ID"
        httpMap: query
    examples:
      - "${cliName} api posts list --json"
      - "${cliName} api posts list --userId 1 --json"

  - id: posts:get
    description: "Get a specific post"
    http:
      method: GET
      path: "/posts/{id}"
    args:
      - name: id
        required: true
        description: "Post ID"
    examples:
      - "${cliName} api posts get 1 --json"

  - id: posts:create
    description: "Create a new post"
    http:
      method: POST
      path: "/posts"
    flags:
      - name: title
        required: true
        description: "Post title"
        httpMap: body
      - name: body
        required: true
        description: "Post content"
        httpMap: body
      - name: userId
        type: number
        default: 1
        description: "Author user ID"
        httpMap: body
    examples:
      - "${cliName} api posts create --title 'Hello' --body 'World' --json"
`;
}

function readmeTpl(projectName, cliName) {
  return `# ${projectName}

> union-cli 기반 통합 CLI

## 빌드 & 실행

\`\`\`bash
# YAML manifest에서 CLI 커맨드 생성
npm run build

# 도움말
npx ${cliName} --help

# 예제 API 호출
npx ${cliName} api posts list --json
npx ${cliName} api posts get 1 --json
npx ${cliName} api posts create --title "Hello" --body "World" --json
\`\`\`

## 개발 모드

빌드 없이 바로 실행할 수 있습니다:

\`\`\`bash
./bin/dev.js --help
./bin/dev.js api posts list --json
\`\`\`

## YAML Manifest 작성

\`plugins/\` 디렉토리에 YAML 파일을 추가하면 빌드 시 자동으로 CLI 커맨드가 생성됩니다.

\`\`\`
plugins/
  example-api.yaml   <- 예제 (수정/삭제 가능)
  my-service.yaml    <- 새 manifest 추가
\`\`\`

수정 후 빌드:

\`\`\`bash
npm run build
\`\`\`

## 출력 형식

\`\`\`bash
npx ${cliName} api posts list               # 테이블 (기본)
npx ${cliName} api posts list --json        # JSON
npx ${cliName} api posts list --format yaml # YAML
npx ${cliName} api posts list --format csv  # CSV
\`\`\`

## 인증 관리

\`\`\`bash
npx ${cliName} auth login      # 로그인
npx ${cliName} auth status     # 상태 확인
npx ${cliName} auth logout     # 로그아웃
npx ${cliName} doctor          # 시스템 진단
\`\`\`

## 문서

- [union-cli 문서](https://github.com/KimSoungRyoul/union-cli)
`;
}

function gitignoreTpl() {
  return `node_modules/
dist/
.union-cli/
oclif.manifest.json
*.tsbuildinfo
`;
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);

  // --help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  ${fmt.bold('create-union-cli')} ${fmt.dim(`v${VERSION}`)}

  ${fmt.dim('Usage:')}
    npx create-union-cli ${fmt.cyan('<project-name>')}
    npx create-union-cli ${fmt.cyan('.')}

  ${fmt.dim('Examples:')}
    npx create-union-cli my-app
    npm create union-cli my-app
`);
    process.exit(0);
  }

  // --version
  if (args.includes('--version') || args.includes('-V')) {
    console.log(VERSION);
    process.exit(0);
  }

  // Determine project directory
  let projectArg = args[0];

  if (!projectArg) {
    if (!process.stdin.isTTY) {
      console.error(`${fmt.red('Error:')} Project name is required in non-interactive mode.`);
      console.error(`  Usage: npx create-union-cli <project-name>`);
      process.exit(1);
    }
    projectArg = await ask(`  ${fmt.cyan('?')} Project name: `);
    if (!projectArg) {
      console.error(`${fmt.red('Error:')} Project name is required.`);
      process.exit(1);
    }
  }

  const isCurrentDir = projectArg === '.';
  const targetDir = isCurrentDir ? process.cwd() : resolve(projectArg);
  const projectName = isCurrentDir ? basename(process.cwd()) : basename(resolve(projectArg));

  // Validate project name
  const nameCheck = validateProjectName(projectName);
  if (!nameCheck.valid) {
    console.error(`\n  ${fmt.red('Error:')} ${nameCheck.error}\n`);
    process.exit(1);
  }

  // Check target directory
  if (!isCurrentDir && existsSync(targetDir)) {
    const contents = readdirSync(targetDir);
    if (contents.length > 0) {
      console.error(`\n  ${fmt.red('Error:')} Directory ${fmt.bold(projectArg)} already exists and is not empty.`);
      console.error(`  Use ${fmt.cyan('npx create-union-cli .')} to scaffold in an existing directory.\n`);
      process.exit(1);
    }
  }

  if (isCurrentDir && existsSync(join(targetDir, 'package.json'))) {
    console.error(`\n  ${fmt.red('Error:')} package.json already exists in current directory.\n`);
    process.exit(1);
  }

  // CLI name
  const defaultCliName = toKebabCase(projectName);
  let cliName = defaultCliName;
  if (process.stdin.isTTY) {
    const input = await ask(`  ${fmt.cyan('?')} CLI command name ${fmt.dim(`(${defaultCliName})`)}: `);
    if (input) cliName = input;
  }

  // Banner
  console.log(`
  ${fmt.bold('Creating union-cli project')} ${fmt.cyan(projectName)}
`);

  // Create directories
  mkdirSync(join(targetDir, 'bin'), { recursive: true });
  mkdirSync(join(targetDir, 'src'), { recursive: true });
  mkdirSync(join(targetDir, 'plugins'), { recursive: true });
  // Write files
  const files = [
    ['package.json', packageJsonTpl(projectName, cliName)],
    ['tsconfig.json', tsconfigTpl()],
    ['bin/run.js', binRunTpl()],
    ['bin/dev.js', binDevTpl()],
    ['src/index.ts', srcIndexTpl()],
    ['plugins/example-api.yaml', exampleManifestTpl(cliName)],
    ['README.md', readmeTpl(projectName, cliName)],
    ['.gitignore', gitignoreTpl()],
  ];

  for (const [filePath, content] of files) {
    const fullPath = join(targetDir, filePath);
    writeFileSync(fullPath, content);
    if (filePath.startsWith('bin/')) {
      chmodSync(fullPath, 0o755);
    }
    console.log(`  ${fmt.green('create')}  ${filePath}`);
  }

  // npm install
  console.log(`\n  Installing dependencies...\n`);
  try {
    execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
  } catch {
    console.log(`\n  ${fmt.yellow('Warning:')} npm install failed. Run it manually.\n`);
  }

  // Summary
  const cdCmd = isCurrentDir ? '' : `cd ${projectArg}`;
  console.log(`
  ${fmt.green('Done!')} Project ${fmt.bold(projectName)} created.

  ${fmt.bold('Next steps:')}
${cdCmd ? `\n    ${fmt.cyan(cdCmd)}\n` : ''}
    ${fmt.dim('# Edit your YAML manifest:')}
    ${fmt.cyan(`vim plugins/example-api.yaml`)}

    ${fmt.dim('# Build commands from YAML:')}
    ${fmt.cyan('npm run build')}

    ${fmt.dim('# Run your CLI:')}
    ${fmt.cyan(`npx ${cliName} --help`)}
    ${fmt.cyan(`npx ${cliName} api posts list --json`)}

    ${fmt.dim('# Development mode (no build needed):')}
    ${fmt.cyan('./bin/dev.js --help')}
`);
}

main().catch((err) => {
  console.error(`\n  ${fmt.red('Error:')} ${err.message}\n`);
  process.exit(1);
});
