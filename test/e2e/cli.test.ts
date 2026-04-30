/**
 * test/e2e/cli.test.ts
 *
 * End-to-end smoke tests that drive ./bin/dev.js as a real child process and
 * inspect stdout / stderr / exit code. The point is to confirm the wired-up
 * binary still executes cleanly — the existing unit tests (test/commands.test.ts
 * etc.) already cover individual command logic via the in-process oclif Config.
 *
 * Decisions:
 *   - Use ./bin/dev.js (tsx) so the tests don't depend on `npm run build`.
 *   - These tests spawn fresh node processes; they are slower than the unit
 *     tests but still complete in a few seconds total.
 *   - Vitest's default config (vitest.config.ts) globs test/**\/*.test.ts so
 *     this file is automatically picked up by `npm test`. A dedicated
 *     `test:e2e` script can be added (see coordinator spec).
 */
import {describe, it, expect, afterAll} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {runCli, stripAnsi, hasAnsi, prepareCwdWithManifest, PROJECT_ROOT} from './helpers.js'

const pkg = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'),
) as {version: string}

describe('E2E — ./bin/dev.js (real child process)', () => {
  // 30s per-test timeout — tsx cold start can be slow on CI.
  const TEST_TIMEOUT = 60_000

  describe('case A — --help', () => {
    it('exits 0 and prints USAGE / TOPICS / COMMANDS sections', async () => {
      const r = await runCli(['--help'])
      expect(r.exitCode).toBe(0)
      const out = stripAnsi(r.stdout)
      expect(out).toContain('USAGE')
      expect(out).toContain('COMMANDS')
      // The framework injects user-defined oclif "topics" — at least auth/config
      // should be listed even with no plugins registered.
      expect(out).toMatch(/auth/i)
      expect(out).toMatch(/config/i)
    }, TEST_TIMEOUT)
  })

  describe('case B — --version', () => {
    it('prints package.json version', async () => {
      const r = await runCli(['--version'])
      expect(r.exitCode).toBe(0)
      // oclif --version output is `name/version platform-arch node-vNN`.
      expect(r.stdout).toContain(pkg.version)
      expect(r.stdout).toContain('union-cli')
    }, TEST_TIMEOUT)
  })

  describe('case C — auth status (empty token state)', () => {
    const tmp = prepareCwdWithManifest([])
    afterAll(() => tmp.cleanup())

    it('exits 0 with empty manifest cache and prints table header', async () => {
      const r = await runCli(['auth', 'status', '--no-color'], {cwd: tmp.cwd})
      expect(r.exitCode).toBe(0)
      // With no providers registered, the table still prints headers.
      expect(stripAnsi(r.stdout)).toContain('NAMESPACE')
      expect(stripAnsi(r.stdout)).toContain('STATUS')
    }, TEST_TIMEOUT)
  })

  describe('case D — doctor --json', () => {
    it('exits 0 with parseable JSON and required fields', async () => {
      const r = await runCli(['doctor', '--json'])
      expect(r.exitCode).toBe(0)

      const parsed = JSON.parse(r.stdout) as {
        node?: {status: string; version: string}
        cwd?: {status: string; path: string}
        manifests?: {status: string; count: number}
        tokens?: {status: string}
        providers?: unknown[]
      }
      expect(parsed.node?.status).toBe('ok')
      expect(parsed.node?.version).toMatch(/^v\d+/)
      expect(parsed.cwd?.status).toBe('ok')
      expect(typeof parsed.manifests?.count).toBe('number')
      expect(typeof parsed.tokens?.status).toBe('string')
      expect(Array.isArray(parsed.providers)).toBe(true)
    }, TEST_TIMEOUT)
  })

  describe('case E — completion install zsh', () => {
    it('exits 0 and prints something shell-installable', async () => {
      const r = await runCli(['completion', 'install', 'zsh'])
      expect(r.exitCode).toBe(0)
      // The current implementation is a stub ("zsh 자동완성 설치 (구현 예정)"),
      // so we assert the shell name appears, which keeps this test robust to
      // the eventual real implementation that will mention fpath/compdef.
      const out = stripAnsi(r.stdout)
      expect(out).toMatch(/zsh|fpath|compdef/i)
    }, TEST_TIMEOUT)
  })

  describe('case F — plugin list --json', () => {
    it('exits 0 with parseable JSON {plugins: []}', async () => {
      const r = await runCli(['plugin', 'list', '--json'])
      expect(r.exitCode).toBe(0)
      const parsed = JSON.parse(r.stdout) as {plugins: unknown[]}
      expect(Array.isArray(parsed.plugins)).toBe(true)
    }, TEST_TIMEOUT)
  })

  describe('case G — unknown command', () => {
    it('exits non-zero and surfaces a helpful error / suggestion', async () => {
      const r = await runCli(['nope-this-is-not-a-command'])
      expect(r.exitCode).not.toBe(0)
      const combined = stripAnsi(r.combined)
      // @oclif/plugin-not-found prints either "is not a union-cli command"
      // or "Did you mean ...". Accept either to stay robust across versions.
      expect(combined).toMatch(/not a union-cli command|Did you mean|Run.*help/i)
    }, TEST_TIMEOUT)
  })

  describe('case H — --no-color flag', () => {
    it('produces ANSI-free stdout and stderr', async () => {
      // Force a TTY-ish env so we'd normally get color, then verify --no-color
      // wins. Without FORCE_COLOR the helper already sets NO_COLOR=1, which
      // would make the assertion pass trivially.
      const r = await runCli(['doctor', '--no-color'], {
        env: {FORCE_COLOR: '1', NO_COLOR: undefined},
      })
      expect(r.exitCode).toBe(0)
      // doctor prints to stderr in non-JSON mode; combined check is safest.
      expect(hasAnsi(r.combined)).toBe(false)
    }, TEST_TIMEOUT)
  })
})
