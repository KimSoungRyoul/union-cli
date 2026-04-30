import {Command, Flags} from '@oclif/core'
import type {HttpProviderConfig} from '../../core/types.js'
import {loadTokens} from '../../core/token-store.js'
import {getAuthConfig, getExecutor, resolveEnvVars, isNoColor} from '../../core/auth-utils.js'

interface StatusRow {
  namespace: string
  auth_type: string
  status: string
  expires: string
}

/** CJK-aware string width calculation for table formatting */
function strWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    w += (cp >= 0x1100 && (cp <= 0x115F || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0x4E00 && cp <= 0x9FFF))) ? 2 : 1
  }
  return w
}

function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - strWidth(s)))
}

export default class AuthStatus extends Command {
  static override description = '인증 상태 조회'

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
    verify: Flags.boolean({description: 'API 호출로 실제 유효성 확인'}),
    'no-color': Flags.boolean({description: '색상/이모지 비활성화'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthStatus)
    const noColor = isNoColor(flags)
    const ok = noColor ? '[OK]' : '\u2713'
    const fail = noColor ? '[X]' : '\u2717'

    const executor = getExecutor()
    const allManifests = executor.registry.getAllManifests()
    const tokens = loadTokens()

    const rows: StatusRow[] = []

    for (const manifest of allManifests) {
      const auth = getAuthConfig(manifest)
      const authType = auth?.type ?? 'none'
      const authServiceName = auth?.serviceName ?? manifest.namespace
      const config = manifest.provider.config as HttpProviderConfig
      const baseUrl = resolveEnvVars(config?.baseUrl ?? '')

      const svcTokens = tokens[authServiceName] as {cookies?: string; access_token?: string; savedAt?: string; expires_in?: number; authType?: string} | undefined
      let status = `${fail} not logged in`
      let expires = '-'

      if (authType === 'none') {
        status = `${ok} (no auth)`
      } else if (svcTokens?.authType === 'device-code' && svcTokens.access_token) {
        // Device Code Flow: stored access_token
        try {
          const parts = svcTokens.access_token.split('.')
          if (parts.length >= 2) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {exp?: number}
            if (payload.exp) {
              const expDate = new Date(payload.exp * 1000)
              expires = expDate.toISOString().replace('T', ' ').substring(0, 19)
              status = expDate > new Date() ? `${ok} valid` : `${fail} expired (refresh available)`
            }
          }
        } catch {
          status = `${ok} token exists`
        }
      } else if (svcTokens?.cookies) {
        // JWT exp check
        const tokenMatch = svcTokens.cookies.match(/_token=([^;]+)/)
        if (tokenMatch) {
          try {
            const parts = tokenMatch[1].split('.')
            if (parts.length >= 2) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {exp?: number}
              if (payload.exp) {
                const expDate = new Date(payload.exp * 1000)
                expires = expDate.toISOString().replace('T', ' ').substring(0, 19)
                status = expDate > new Date()
                  ? `${ok} valid`
                  : `${fail} expired`
              }
            }
          } catch {
            status = `${ok} token exists`
          }
        } else {
          status = `${ok} token exists`
        }

        // --verify: actual API call to verify
        if (flags.verify && status.includes(ok)) {
          try {
            const tokenCookie = svcTokens.cookies.split('; ').find(
              (c: string) => /_token=/.test(c) && !/_refresh_token=/.test(c),
            )
            const tokenVal = tokenCookie?.split('=').slice(1).join('=') ?? ''
            const meUrl = baseUrl.replace(/\$\{[^}]+\}/g, '').replace(/\/api\/v\d+$/, '') + '/api/v1/auth/me'
            const resp = await fetch(meUrl, {headers: {Authorization: 'Bearer ' + tokenVal}, signal: AbortSignal.timeout(5000)})
            if (!resp.ok) status = `${fail} invalid (${resp.status})`
          } catch {
            status = `${fail} unreachable`
          }
        }
      }

      rows.push({namespace: manifest.namespace, auth_type: authType, status, expires})
    }

    if (flags.json) {
      this.log(JSON.stringify(rows, null, 2))
      return
    }

    const keys: (keyof StatusRow)[] = ['namespace', 'auth_type', 'status', 'expires']
    const headers = ['NAMESPACE', 'AUTH TYPE', 'STATUS', 'EXPIRES']
    const widths = keys.map((k, i) => Math.max(headers[i].length, ...rows.map(r => strWidth(String(r[k])))))

    this.log(headers.map((h, i) => padEnd(h, widths[i])).join('  '))
    this.log(widths.map(w => '-'.repeat(w)).join('  '))
    for (const row of rows) {
      this.log(keys.map((k, i) => padEnd(String(row[k]), widths[i])).join('  '))
    }
  }
}
