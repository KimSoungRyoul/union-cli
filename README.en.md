# union-cli

> A framework for generating a unified CLI from a YAML declaration

---

## Quickstart

### 1. Create a project

```bash
npx create-union-cli my-cli
cd my-cli
```

### 2. Write a YAML manifest

```yaml
# plugins/my-api.yaml
name: my-api
namespace: api
description: "My service API"
provider:
  type: http
  config:
    baseUrl: "https://api.example.com/v1"
    auth:
      type: bearer
      token:
        env: "MY_API_TOKEN"

commands:
  - id: users:list
    description: "List users"
    http:
      method: GET
      path: "/users"
    flags:
      - name: limit
        type: number
        default: 20
        httpMap: query

  - id: users:create
    description: "Create a user"
    http:
      method: POST
      path: "/users"
    flags:
      - name: name
        required: true
        httpMap: body
      - name: email
        required: true
        httpMap: body
```

### 3. Build and run

```bash
npm run build
# 4 commands generated

npx my-cli --help
npx my-cli api users list --json
npx my-cli api users create --name "John" --email "john@example.com" --json
```

---

## Provider Types

| Provider | Use Case | Transport | Extras |
|----------|----------|-----------|--------|
| **HTTP** | REST API calls | `fetch` | retry (exponential backoff + jitter, honors Retry-After) |
| **CLI** | Wrap external binaries | `spawn` | output parsers (json/lines/csv/regex) |
| **Python** | Invoke Python functions | JSON-RPC over stdio | persistent/oneshot, venv |
| **JS** | Invoke Node.js modules | in-process ESM/CJS | module caching |

---

## Authentication

| Type | Configuration | Behavior |
|------|---------------|----------|
| `none` | `type: none` | Request without authentication |
| `bearer` | `type: bearer` + `token` | `Authorization: Bearer {token}` |
| `basic` | `type: basic` + `credentials` | `Authorization: Basic {base64}` |
| `jwt` | `type: jwt` + `tokenEndpoint` | Automatic token issuance + TTL caching |
| `api-key` | `type: api-key` + `headerName` | `{headerName}: {token}` |
| `cookie` | `type: cookie` + `serviceName` | OAuth browser login -> stores cookie |

```yaml
auth:
  type: bearer
  token:
    env: "MY_API_TOKEN"     # Environment variable
    file: "/path/to/token"  # File
    command: "vault read"   # Run a command
```

---

## Built-in Commands

When you register union-cli as an oclif plugin, the following commands are provided automatically:

```bash
my-cli auth login               # Sequentially log in to all providers
my-cli auth login <namespace>   # Log in to a specific provider only
my-cli auth status              # Authentication status table
my-cli auth status --verify     # Validate by making a real API call
my-cli auth logout              # Log out of everything
my-cli auth token <namespace>   # Print the token (pipe-friendly)

my-cli doctor                   # Check system + provider health
my-cli doctor --json

my-cli plugin add <pkg-or-path> # Register an npm package / local path / git URL plugin
my-cli plugin list              # List registered plugins (table/--json)
my-cli plugin remove <name>     # Remove a plugin (use --purge to delete local files)
```

```
NAMESPACE   AUTH TYPE  STATUS     EXPIRES
---------   ---------  ---------  -------------------
api         bearer     ✓ valid    2026-04-07 09:18:50
auth-svc    cookie     ✗ expired  2026-04-07 08:32:50
public      none       ✓ (no auth)
```

---

## Output Format

Standard flags are applied automatically to every command:

```bash
my-cli api users list                    # Table (default)
my-cli api users list --json             # JSON
my-cli api users list --format yaml      # YAML
my-cli api users list --format csv       # CSV
my-cli api users list --quiet            # No output (exit code only)
```

**Colors**: ANSI colors are applied automatically in TTY environments (errors=red, success=green, warnings=yellow, headers=bold). JSON/YAML output stays raw (safe for pipes/redirects).
- `NO_COLOR=1` or `--no-color`: disable
- `FORCE_COLOR=1`: force-enable (even in non-TTY environments)
- `TERM=dumb`: auto-disable

## Credential Storage

You can choose how credentials are stored via `provider.config.credentialStore` in the manifest.

| Value | Behavior | Use Case |
|-------|----------|----------|
| `file` (default) | `~/.<cli-name>/credentials/<ns>.json` (chmod 0600) | Default / personal |
| `keychain` | macOS Keychain / Linux libsecret / Windows Credential Manager | Desktop |
| `env` | `<CLI>_<NS>_TOKEN` environment variable (read-only) | CI/CD |

When `keychain` is selected and the OS CLI (`security` / `secret-tool` / `cmdkey`) is not on PATH, it gracefully falls back to `file`.

## HTTP Retry

You can configure an automatic retry policy via `provider.config.retry` in the manifest.

```yaml
provider:
  type: http
  config:
    baseUrl: https://api.example.com
    retry:
      attempts: 3
      retryOn: [429, 500, 502, 503, 504]
      jitter: full              # full | equal | none
      idempotent: auto          # auto = retry only GET/HEAD/PUT/DELETE
```

- The retry policy does not apply to 401 responses (handled by JWT refresh in auth-handlers).
- The `Retry-After` header takes precedence when present (capped by `maxDelayMs`).

## HTTP Pagination

You can declare cursor / offset / link-header pagination (three styles) in the manifest.

```yaml
provider:
  type: http
  config:
    baseUrl: https://api.example.com
    pagination:
      style: cursor              # cursor | offset | link-header
      pageParam: cursor
      itemsPath: data
      nextPath: meta.next_cursor
      maxPages: 100
```

Passing `--all` when running a command accumulates every page and returns a single array. It also integrates with the retry policy automatically (retry is applied to each page request).

## Interactive Prompt

In TTY environments, missing required flags trigger an automatic prompt (inputs are hidden for `password`/`token`/`secret` and similar).

```bash
my-cli api users create     # Prompts when email is missing
> ? email: john@example.com
```

- Disable with the `--no-input` flag or the `NO_INPUT=1` / `UNION_CLI_NO_INPUT=1` environment variable (for CI/scripts).
- In non-TTY environments, prompts are skipped automatically and fall back to oclif's missing-flag error.

## Windows Support

- The Python provider's venv path is automatically routed to `Scripts/python.exe` on win32.
- The CI matrix validates `ubuntu-latest` x `windows-latest` x `macos-latest` x `node 20/22` = 6 combinations.

## Testing

```bash
npm test              # Everything (unit + e2e)
npm run test:unit     # Unit only (fast)
npm run test:e2e      # E2E only (integration via ./bin/dev.js)
npm run test:coverage # With coverage
```

E2E uses `./bin/dev.js` (tsx) so it runs without depending on `npm run build`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Interface                                         │
│  plugins/*.yaml — the only file users author                │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Build                                             │
│  YAML parse -> validate -> codegen (emit oclif Command JS)  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: CLI (oclif)                                       │
│  Command parsing, standard flags, help, completion          │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Provider                                          │
│  HTTP (fetch) · CLI (spawn) · Python (JSON-RPC) · JS (ESM)  │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: Core Infrastructure                               │
│  Auth · Output · Config · CredentialStore · Error           │
└─────────────────────────────────────────────────────────────┘
```

---

## Examples

Working sample projects for each Provider:

- [http-jsonplaceholder](./examples/http-jsonplaceholder) — HTTP provider, JSONPlaceholder REST API
- [cli-wrap](./examples/cli-wrap) — CLI provider, wrapping git commands
- [python-sdk](./examples/python-sdk) — Python provider, numpy stats over JSON-RPC
- [js-module](./examples/js-module) — JS provider, local ESM functions in-process

---

## Shell Completion

To install zsh / bash / fish completions:

```bash
my-cli completion install              # Auto-detect via the SHELL environment variable
my-cli completion install zsh          # Explicit
my-cli completion install bash --apply # Edit ~/.bashrc directly (risky)
my-cli completion install fish --dry-run --apply
```

Without `--apply`, only the instructions and the script are printed to stdout (safe by default).

---

## Related Docs

- [Architecture (Docs)](https://kimsoungryoul.github.io/union-cli/) — 5-layer architecture + execution flow
- [plan.md](./plan.md) — Framework design plan

---

## License

MIT
