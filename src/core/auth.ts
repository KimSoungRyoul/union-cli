import type {AuthConfig} from './types.js'
import type {CredentialStore} from './credential-store.js'
import {resolveSecret} from './credential-store.js'

interface CachedToken {
  token: string
  expiresAt: number
}

interface JwtRefreshResponse {
  token?: string
  access_token?: string
  expires_in?: number
}

/**
 * JWT 토큰의 payload에서 `exp` claim (초 단위 epoch)을 추출합니다.
 * 실패 시 null을 반환합니다.
 */
export function parseJwtExp(token: string): number | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf-8')
    const payload = JSON.parse(json) as {exp?: unknown}
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp
    }
    return null
  } catch {
    return null
  }
}

export class AuthManager {
  private jwtCache = new Map<string, CachedToken>()
  /** 동시 refresh 디듀프용 — 같은 namespace에 대한 진행 중 Promise가 있으면 재사용 */
  private refreshPromises = new Map<string, Promise<string>>()

  constructor(private readonly store: CredentialStore) {}

  async getAuthHeader(
    namespace: string,
    authConfig: AuthConfig,
  ): Promise<Record<string, string>> {
    switch (authConfig.type) {
      case 'none':
        return {}

      case 'bearer': {
        const token = await this.resolveToken(authConfig)
        if (!token) return {}
        return {Authorization: `Bearer ${token}`}
      }

      case 'basic': {
        const username = authConfig.credentials?.username
          ? await resolveSecret(authConfig.credentials.username)
          : null
        const password = authConfig.credentials?.password
          ? await resolveSecret(authConfig.credentials.password)
          : null
        if (!username || !password) return {}
        const encoded = Buffer.from(`${username}:${password}`).toString('base64')
        return {Authorization: `Basic ${encoded}`}
      }

      case 'api-key': {
        const token = await this.resolveToken(authConfig)
        if (!token) return {}
        const headerName = authConfig.headerName ?? 'X-API-Key'
        return {[headerName]: token}
      }

      case 'jwt': {
        const cached = this.jwtCache.get(namespace)
        if (cached && cached.expiresAt > Date.now()) {
          return {Authorization: `Bearer ${cached.token}`}
        }

        const token = await this.getOrCreateRefresh(namespace, authConfig)
        return {Authorization: `Bearer ${token}`}
      }

      default:
        return {}
    }
  }

  /**
   * 동일 namespace에 대한 refresh가 이미 진행 중이면 그 Promise를 재사용(thundering herd 방지).
   */
  private async getOrCreateRefresh(namespace: string, authConfig: AuthConfig): Promise<string> {
    const existing = this.refreshPromises.get(namespace)
    if (existing) return existing

    const promise = this.refreshJWT(namespace, authConfig).finally(() => {
      this.refreshPromises.delete(namespace)
    })
    this.refreshPromises.set(namespace, promise)
    return promise
  }

  /**
   * 내부 구현 — 동시성 디듀프를 거치지 않고 직접 토큰 엔드포인트를 호출해 캐시를 갱신한다.
   * 외부에서는 `getAuthHeader`를 사용해야 `refreshPromises`를 거쳐 중복 요청이 방지된다.
   */
  private async refreshJWT(namespace: string, authConfig: AuthConfig): Promise<string> {
    const endpoint = authConfig.tokenEndpoint
    if (!endpoint) {
      throw new Error('JWT auth requires a tokenEndpoint')
    }

    const username = authConfig.credentials?.username
      ? await resolveSecret(authConfig.credentials.username)
      : null
    const password = authConfig.credentials?.password
      ? await resolveSecret(authConfig.credentials.password)
      : null

    let res: Response
    if (authConfig.tokenRequestFormat === 'form') {
      // OIDC / Keycloak form-urlencoded 방식
      const params = new URLSearchParams()
      params.set('grant_type', authConfig.grantType ?? 'password')
      if (authConfig.clientId) params.set('client_id', authConfig.clientId)
      if (authConfig.clientSecret) {
        const secret = await resolveSecret(authConfig.clientSecret)
        if (secret) params.set('client_secret', secret)
      }
      if (username) params.set('username', username)
      if (password) params.set('password', password)
      if (authConfig.scope) params.set('scope', authConfig.scope)

      res = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: params.toString(),
      })
    } else {
      // 기존 JSON 방식 (하위호환)
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password}),
      })
    }

    if (!res.ok) {
      throw new Error(`JWT refresh failed: ${res.status} ${res.statusText}`)
    }

    const body = (await res.json()) as JwtRefreshResponse
    const token = body.token ?? body.access_token
    if (!token) {
      throw new Error('JWT response does not contain a token')
    }

    // TTL 우선순위: expires_in → JWT exp claim → authConfig.tokenTTL → 3600 (기본)
    // 30초 안전 마진을 두어 서버 시각과의 skew + 네트워크 지연을 흡수한다.
    const nowSec = Math.floor(Date.now() / 1000)
    let ttlSec: number
    if (typeof body.expires_in === 'number' && body.expires_in > 0) {
      ttlSec = body.expires_in
    } else {
      const exp = parseJwtExp(token)
      if (exp !== null && exp > nowSec) {
        ttlSec = exp - nowSec
      } else {
        ttlSec = authConfig.tokenTTL ?? 3600
      }
    }
    const SAFETY_MARGIN_SEC = 30
    const effectiveTtl = Math.max(1, ttlSec - SAFETY_MARGIN_SEC)

    this.jwtCache.set(namespace, {
      token,
      expiresAt: Date.now() + effectiveTtl * 1000,
    })

    return token
  }

  async isAuthenticated(namespace: string): Promise<boolean> {
    const creds = await this.store.get(namespace)
    return creds !== null
  }

  /** 테스트 용도: 네임스페이스의 JWT 캐시를 무효화 */
  invalidateJwtCache(namespace: string): void {
    this.jwtCache.delete(namespace)
  }

  private async resolveToken(authConfig: AuthConfig): Promise<string | null> {
    if (authConfig.token) {
      return resolveSecret(authConfig.token)
    }

    return null
  }
}
