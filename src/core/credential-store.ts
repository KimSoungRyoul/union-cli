import {execFileSync} from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import type {SecretRef} from './types.js'

// ── CredentialStore interface ──

export interface CredentialStore {
  get(ns: string): Promise<Record<string, string> | null>
  set(ns: string, creds: Record<string, string>): Promise<void>
  delete(ns: string): Promise<void>
}

// ── FileCredentialStore ──

export class FileCredentialStore implements CredentialStore {
  constructor(private readonly credentialsDir: string) {}

  private filePath(ns: string): string {
    return path.join(this.credentialsDir, `${ns}.json`)
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.credentialsDir, {recursive: true})
  }

  async get(ns: string): Promise<Record<string, string> | null> {
    try {
      const data = await fs.readFile(this.filePath(ns), 'utf-8')
      return JSON.parse(data) as Record<string, string>
    } catch {
      return null
    }
  }

  async set(ns: string, creds: Record<string, string>): Promise<void> {
    await this.ensureDir()
    const fp = this.filePath(ns)
    await fs.writeFile(fp, JSON.stringify(creds, null, 2), 'utf-8')
    await fs.chmod(fp, 0o600)
  }

  async delete(ns: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(ns))
    } catch {
      // ignore if file doesn't exist
    }
  }
}

// ── EnvCredentialStore ──

export class EnvCredentialStore implements CredentialStore {
  async get(ns: string): Promise<Record<string, string> | null> {
    const prefix = ns.toUpperCase()
    const token = process.env[`${prefix}_TOKEN`]
    if (!token) return null
    return {token}
  }

  async set(_ns: string, _creds: Record<string, string>): Promise<void> {
    // no-op: environment variables are read-only
  }

  async delete(_ns: string): Promise<void> {
    // no-op: environment variables are read-only
  }
}

// ── resolveSecret ──

export async function resolveSecret(ref: SecretRef): Promise<string | null> {
  if (ref.env) {
    return process.env[ref.env] ?? null
  }

  if (ref.file) {
    try {
      return await fs.readFile(ref.file, 'utf-8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        return null
      }
      if (nodeErr.code === 'EACCES') {
        throw new Error(`Permission denied reading secret file: "${ref.file}". Check file permissions.`, {cause: err})
      }
      throw err
    }
  }

  if (ref.command) {
    try {
      const parts = ref.command.split(/\s+/)
      const result = execFileSync(parts[0], parts.slice(1), {timeout: 10000, encoding: 'utf-8'})
      return result.trim()
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        throw new Error(`Command not found: "${ref.command.split(/\s+/)[0]}". Ensure it is installed and in your PATH.`, {cause: err})
      }
      const execErr = err as {status?: number; stderr?: Buffer | string}
      const stderr = execErr.stderr ? execErr.stderr.toString().trim() : ''
      const exitCode = execErr.status ?? 'unknown'
      throw new Error(`Secret command failed (exit code ${exitCode}): "${ref.command}"${stderr ? `\n${stderr}` : ''}`, {cause: err})
    }
  }

  if (ref.value !== undefined) {
    return ref.value
  }

  return null
}
