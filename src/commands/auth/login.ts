import {Command, Args, Flags} from '@oclif/core'
import type {HttpProviderConfig} from '../../core/types.js'
import {loadTokens, saveTokens, decryptChromeCookies} from '../../core/token-store.js'
import {execFileSync} from 'node:child_process'
import {createInterface} from 'node:readline'
import {getAuthConfig, getExecutor, resolveEnvVars, isNoColor} from '../../core/auth-utils.js'

interface ManifestInfo {
  namespace: string
  authType: string
  authServiceName: string
  baseUrl: string
}

interface LoginResult {
  namespace: string
  status: string
  message?: string
  cookies?: number
  authType?: string
}

function ask(question: string): Promise<string> {
  const rl = createInterface({input: process.stdin, output: process.stderr})
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer) }))
}

export default class AuthLogin extends Command {
  static override description = '인증 로그인 (모든 provider 또는 특정 namespace)'

  static override examples = [
    'auth login',
    'auth login lona',
  ]

  static override args = {
    namespace: Args.string({description: 'Provider namespace (생략 시 전체 로그인)', required: false}),
  }

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
    'no-color': Flags.boolean({description: '색상/이모지 비활성화'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AuthLogin)
    const noColor = isNoColor(flags)

    const executor = getExecutor()
    const allManifests = executor.registry.getAllManifests()
    const manifestInfos: ManifestInfo[] = allManifests.map(m => {
      const auth = getAuthConfig(m)
      const config = m.provider.config as HttpProviderConfig
      return {
        namespace: m.namespace,
        authType: auth?.type ?? 'none',
        authServiceName: auth?.serviceName ?? m.namespace,
        baseUrl: resolveEnvVars(config?.baseUrl ?? ''),
      }
    })

    const targets = args.namespace
      ? manifestInfos.filter(m => m.namespace === args.namespace)
      : manifestInfos

    if (targets.length === 0) {
      this.error(args.namespace ? `Namespace "${args.namespace}" not found` : 'No manifests found')
    }

    const results: LoginResult[] = []

    for (const m of targets) {
      this.logToStderr(`\n${noColor ? '[AUTH]' : '🔐'} ${m.namespace} (${m.authType}) 로그인...`)

      if (m.authType === 'none') {
        this.logToStderr(`  ${noColor ? '[INFO]' : 'ℹ'} ${m.namespace}: 인증 불필요`)
        results.push({namespace: m.namespace, status: 'skipped', message: 'no auth required'})
        continue
      }

      if (m.authType === 'cookie') {
        // OAuth: browser login -> Chrome cookie extraction
        const loginUrl = m.baseUrl.replace(/\/api\/v1$/, '') + '/api/v1/auth/login'
        try {
          const resp = await fetch(loginUrl)
          const data = await resp.json() as {data?: {auth_url?: string}; auth_url?: string}
          const authUrl = data.data?.auth_url ?? data.auth_url
          if (authUrl) {
            this.logToStderr('  브라우저에서 로그인하세요...')
            try { execFileSync('open', [authUrl]) } catch { /* ignore open failure */ }
            await ask('  로그인 완료 후 Enter를 누르세요: ')
          }
        } catch { /* ignore fetch errors */ }

        // Extract token from Chrome cookies
        const host = new URL(m.baseUrl.replace(/\$\{[^}]+\}/g, 'placeholder')).hostname
        const cookies = decryptChromeCookies(host)
        if (cookies && cookies.length > 0) {
          const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
          const tokens = loadTokens()
          tokens[m.authServiceName] = {cookies: cookieStr, savedAt: new Date().toISOString()}
          saveTokens(tokens)
          this.logToStderr(`  ${noColor ? '[OK]' : '✅'} ${m.namespace}: ${cookies.length}개 쿠키 저장 완료`)
          results.push({namespace: m.namespace, status: 'success', cookies: cookies.length})
        } else {
          this.logToStderr(`  ${noColor ? '[FAIL]' : '❌'} ${m.namespace}: 쿠키를 찾을 수 없습니다. 브라우저에서 로그인했는지 확인하세요.`)
          this.logToStderr(`    (상세 원인: DEBUG=1 npx ${this.config.bin} auth login ${m.namespace})`)
          results.push({namespace: m.namespace, status: 'failed', message: 'no cookies found'})
        }
        continue
      }

      if (m.authType === 'bearer' || m.authType === 'api-key') {
        const token = await ask(`  ${m.namespace} 토큰을 입력하세요: `)
        const tokens = loadTokens()
        tokens[m.authServiceName] = {cookies: `${m.authServiceName}_token=${token}`, savedAt: new Date().toISOString()}
        saveTokens(tokens)
        this.logToStderr(`  ${noColor ? '[OK]' : '✅'} ${m.namespace}: 토큰 저장 완료`)
        results.push({namespace: m.namespace, status: 'success'})
        continue
      }

      if (m.authType === 'device-code') {
        const manifest = allManifests.find(mf => mf.namespace === m.namespace)
        const auth = manifest ? getAuthConfig(manifest) : null
        if (!auth?.deviceAuthEndpoint || !auth?.tokenEndpoint || !auth?.clientId) {
          this.logToStderr(`  ${noColor ? '[FAIL]' : '❌'} ${m.namespace}: device-code 설정 불완전 (deviceAuthEndpoint, tokenEndpoint, clientId 필요)`)
          results.push({namespace: m.namespace, status: 'failed', message: 'incomplete device-code config'})
          continue
        }

        try {
          // Step 1: Request device code
          const deviceParams = new URLSearchParams()
          deviceParams.set('client_id', auth.clientId)
          if (auth.scope) deviceParams.set('scope', auth.scope)

          const deviceResp = await fetch(resolveEnvVars(auth.deviceAuthEndpoint), {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: deviceParams.toString(),
          })
          if (!deviceResp.ok) {
            const errBody = await deviceResp.text()
            throw new Error(`Device auth request failed: ${deviceResp.status} ${errBody}`)
          }
          const deviceData = await deviceResp.json() as {
            device_code: string; user_code: string;
            verification_uri: string; verification_uri_complete?: string;
            expires_in: number; interval: number;
          }

          // Step 2: Show user the code
          this.logToStderr('')
          this.logToStderr(`  ${noColor ? '[INFO]' : '🔑'} 브라우저에서 아래 URL을 열고 코드를 입력하세요:`)
          this.logToStderr(`     URL:  ${deviceData.verification_uri}`)
          this.logToStderr(`     Code: ${deviceData.user_code}`)
          if (deviceData.verification_uri_complete) {
            this.logToStderr('')
            this.logToStderr(`     또는 이 링크를 직접 열기:`)
            this.logToStderr(`     ${deviceData.verification_uri_complete}`)
          }
          this.logToStderr('')
          this.logToStderr(`  ${noColor ? '[WAIT]' : '⏳'} 인증 대기 중... (${Math.floor(deviceData.expires_in / 60)}분 내에 완료해주세요)`)

          // Try to open browser automatically
          try { execFileSync('open', [deviceData.verification_uri_complete ?? deviceData.verification_uri]) } catch { /* ignore */ }

          // Step 3: Poll token endpoint
          const tokenEndpoint = resolveEnvVars(auth.tokenEndpoint)
          const pollInterval = (deviceData.interval || 5) * 1000
          const deadline = Date.now() + deviceData.expires_in * 1000

          interface DeviceTokenResult {access_token: string; refresh_token?: string; expires_in?: number}
          let tokenResult: DeviceTokenResult | null = null
          while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, pollInterval))

            const tokenParams = new URLSearchParams()
            tokenParams.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code')
            tokenParams.set('client_id', auth.clientId)
            tokenParams.set('device_code', deviceData.device_code)

            const tokenResp = await fetch(tokenEndpoint, {
              method: 'POST',
              headers: {'Content-Type': 'application/x-www-form-urlencoded'},
              body: tokenParams.toString(),
            })

            if (tokenResp.ok) {
              tokenResult = await tokenResp.json() as DeviceTokenResult
              break
            }

            const errData = await tokenResp.json() as {error?: string}
            if (errData.error === 'authorization_pending') {
              continue // keep polling
            } else if (errData.error === 'slow_down') {
              await new Promise(resolve => setTimeout(resolve, 5000)) // back off
              continue
            } else {
              throw new Error(`Token polling failed: ${errData.error}`)
            }
          }

          if (!tokenResult || !tokenResult.access_token) {
            throw new Error('Device code expired before authentication completed')
          }

          // Step 4: Save tokens
          const finalToken = tokenResult
          const tokens = loadTokens()
          tokens[m.authServiceName] = {
            access_token: finalToken.access_token,
            refresh_token: finalToken.refresh_token ?? '',
            expires_in: finalToken.expires_in ?? 300,
            savedAt: new Date().toISOString(),
            authType: 'device-code',
          }
          saveTokens(tokens)

          this.logToStderr(`  ${noColor ? '[OK]' : '✅'} ${m.namespace}: 로그인 성공!`)
          results.push({namespace: m.namespace, status: 'success'})
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.logToStderr(`  ${noColor ? '[FAIL]' : '❌'} ${m.namespace}: ${msg}`)
          results.push({namespace: m.namespace, status: 'failed', message: msg})
        }
        continue
      }

      if (m.authType === 'jwt') {
        // JWT(ROPC) 인증은 환경변수로 자동 인증 — login 불필요
        this.logToStderr(`  ${noColor ? '[INFO]' : 'ℹ'} ${m.namespace}: JWT 인증은 환경변수(credentials)로 자동 인증됩니다`)
        results.push({namespace: m.namespace, status: 'skipped', message: 'JWT auto-auth via env vars'})
        continue
      }

      this.logToStderr(`  ${noColor ? '[WARN]' : '⚠'} ${m.namespace}: auth type "${m.authType}" 미지원`)
      results.push({namespace: m.namespace, status: 'unsupported', authType: m.authType})
    }

    if (flags.json) {
      this.log(JSON.stringify(results, null, 2))
    }
  }
}
