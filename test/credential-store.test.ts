import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {FileCredentialStore, resolveSecret} from '../src/core/credential-store.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cred-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true})
})

describe('FileCredentialStore', () => {
  it('set → get으로 자격 증명을 저장하고 읽는다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await store.set('myapp', {token: 'abc123', user: 'admin'})

    const creds = await store.get('myapp')
    expect(creds).toEqual({token: 'abc123', user: 'admin'})
  })

  it('파일 권한을 0o600으로 설정한다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await store.set('myapp', {token: 'secret'})

    const stat = await fs.stat(path.join(tmpDir, 'myapp.json'))
    // 0o600 = 384 decimal; check owner permissions only (mask with 0o777)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('존재하지 않는 namespace는 null을 반환한다', async () => {
    const store = new FileCredentialStore(tmpDir)
    const creds = await store.get('unknown')
    expect(creds).toBeNull()
  })

  it('delete로 자격 증명을 삭제한다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await store.set('myapp', {token: 'abc'})
    await store.delete('myapp')

    const creds = await store.get('myapp')
    expect(creds).toBeNull()
  })

  it('존재하지 않는 namespace를 delete해도 에러가 발생하지 않는다', async () => {
    const store = new FileCredentialStore(tmpDir)
    await expect(store.delete('nonexistent')).resolves.toBeUndefined()
  })
})

describe('resolveSecret', () => {
  it('env로 환경 변수 값을 읽는다', async () => {
    process.env['TEST_RESOLVE_SECRET_TOKEN'] = 'env-value-123'
    try {
      const val = await resolveSecret({env: 'TEST_RESOLVE_SECRET_TOKEN'})
      expect(val).toBe('env-value-123')
    } finally {
      delete process.env['TEST_RESOLVE_SECRET_TOKEN']
    }
  })

  it('value로 직접 값을 반환한다', async () => {
    const val = await resolveSecret({value: 'direct-secret'})
    expect(val).toBe('direct-secret')
  })

  it('존재하지 않는 환경 변수는 null을 반환한다', async () => {
    const val = await resolveSecret({env: 'DEFINITELY_NOT_SET_XYZ_123'})
    expect(val).toBeNull()
  })

  it('빈 ref는 null을 반환한다', async () => {
    const val = await resolveSecret({})
    expect(val).toBeNull()
  })

  it('file이 존재하지 않으면 null을 반환한다 (ENOENT)', async () => {
    const val = await resolveSecret({file: '/tmp/nonexistent-secret-file-xyz'})
    expect(val).toBeNull()
  })

  it('file 권한 거부 시 에러를 던진다 (EACCES)', async () => {
    // Create a file and remove read permissions to trigger EACCES
    const noReadFile = path.join(tmpDir, 'no-read-secret')
    await fs.writeFile(noReadFile, 'secret-data')
    await fs.chmod(noReadFile, 0o000) // no permissions at all

    try {
      await expect(resolveSecret({file: noReadFile})).rejects.toThrow(
        `Permission denied reading secret file: "${noReadFile}"`,
      )
    } finally {
      // Restore permissions so cleanup can delete it
      await fs.chmod(noReadFile, 0o644)
    }
  })

  it('command로 시크릿 값을 읽는다', async () => {
    const val = await resolveSecret({command: 'echo hello-secret'})
    expect(val).toBe('hello-secret')
  })

  it('command를 찾을 수 없으면 에러를 던진다', async () => {
    await expect(
      resolveSecret({command: 'nonexistent-binary-xyz-123'}),
    ).rejects.toThrow('Command not found: "nonexistent-binary-xyz-123"')
  })

  it('command 실패 시 exit code와 함께 에러를 던진다', async () => {
    await expect(
      resolveSecret({command: 'node -e process.exit(42)'}),
    ).rejects.toThrow('Secret command failed (exit code 42)')
  })
})
