import type {AuthConfig} from '../../core/types.js'
import {logger} from '../../core/logger.js'

/**
 * Apply authentication headers based on the auth configuration and resolved credentials.
 *
 * - none / undefined: return headers unchanged
 * - bearer / jwt: Authorization: Bearer <token>  (빈 토큰이면 헤더를 생성하지 않음 + 경고)
 * - basic: Authorization: Basic <base64(username:password)>  (빈 값이면 헤더 생성 생략)
 * - api-key: headerName (default X-API-Key): <token>  (빈 토큰이면 생략)
 * - cookie: 지정된 쿠키에서 JWT를 추출해 Bearer 헤더 생성, 원본 쿠키는 Cookie 헤더에 설정
 */
export function applyAuth(
  headers: Record<string, string>,
  authConfig: AuthConfig | undefined,
  credentials: Record<string, string> | null,
): Record<string, string> {
  if (!authConfig || authConfig.type === 'none') {
    return headers
  }

  const merged = {...headers}

  switch (authConfig.type) {
    case 'bearer':
    case 'jwt':
    case 'device-code': {
      const token = credentials?.token ?? ''
      if (!token) {
        logger.warn(`Warning: auth type "${authConfig.type}" is configured but token is empty.`)
        // 깨진 `Authorization: Bearer ` 헤더를 서버로 보내지 않기 위해 헤더 자체를 생성하지 않는다.
        break
      }
      merged['Authorization'] = `Bearer ${token}`
      break
    }

    case 'basic': {
      const username = credentials?.username ?? ''
      const password = credentials?.password ?? ''
      if (!username || !password) {
        logger.warn(
          `Warning: auth type "basic" is configured but credentials are incomplete ` +
          `(username=${username ? 'set' : 'empty'}, password=${password ? 'set' : 'empty'}).`,
        )
        break
      }
      const encoded = Buffer.from(`${username}:${password}`).toString('base64')
      merged['Authorization'] = `Basic ${encoded}`
      break
    }

    case 'api-key': {
      const headerName = authConfig.headerName ?? 'X-API-Key'
      const token = credentials?.token ?? ''
      if (!token) {
        logger.warn(`Warning: auth type "api-key" is configured but token is empty.`)
        break
      }
      merged[headerName] = token
      break
    }

    case 'cookie': {
      const cookies = credentials?.cookies ?? ''
      if (!cookies) {
        logger.warn(`Warning: auth type "cookie" is configured but no cookies found. Run "auth login" first.`)
        break
      }
      const {bearerToken, sanitizedCookieHeader} = extractCookieAuth(cookies, authConfig)
      if (bearerToken) {
        merged['Authorization'] = `Bearer ${bearerToken}`
      } else {
        const hint = authConfig.cookieName
          ? `cookieName="${authConfig.cookieName}"`
          : authConfig.serviceName
          ? `serviceName="${authConfig.serviceName}"`
          : '*_token 패턴'
        logger.warn(`Warning: auth type "cookie" could not locate a token cookie (${hint}).`)
      }
      merged['Cookie'] = sanitizedCookieHeader
      break
    }

    default:
      // custom or unknown auth type — return headers unchanged
      break
  }

  return merged
}

/**
 * 쿠키 문자열에서 인증용 토큰을 찾아 Bearer 토큰과 정제된 Cookie 헤더를 반환한다.
 *
 * 쿠키 매칭 우선순위:
 *   1. authConfig.cookieName  → `^${cookieName}=` 정확 매칭
 *   2. authConfig.serviceName → `^${serviceName}_token=` 매칭 (단, `_refresh_token=`은 제외)
 *   3. 폴백: `^[^=]*_token=` heuristic (단, `_refresh_token=`은 제외)
 *
 * JWT 앞에 비ASCII prefix(Chrome 쿠키 decrypt 잔여)가 붙은 경우 `eyJ`로 시작하는 JWT 본문만 추출.
 *
 * Cookie 헤더는 토큰 쿠키의 value에 한해 비ASCII를 제거한다 (정상 비ASCII 쿠키를 파괴하지 않기 위함).
 */
function extractCookieAuth(
  cookies: string,
  authConfig: AuthConfig,
): {bearerToken: string | null; sanitizedCookieHeader: string} {
  // `;` 뒤에 공백이 없더라도 안전하게 split
  const parts = cookies.split(/;\s*/).filter((p) => p.length > 0)

  const matcher = buildCookieMatcher(authConfig)
  let bearerToken: string | null = null

  const cleaned: string[] = []
  for (const part of parts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) {
      cleaned.push(part)
      continue
    }
    const name = part.slice(0, eqIdx)
    const rawValue = part.slice(eqIdx + 1)

    if (matcher(name)) {
      // JWT 본문만 추출하고, 이 쿠키의 value에 한해 비ASCII 제거
      const jwtMatch = rawValue.match(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/)
      bearerToken = jwtMatch ? jwtMatch[1] : rawValue.replace(/[^\x20-\x7E]/g, '')
      const cleanedValue = rawValue.replace(/[^\x20-\x7E]/g, '')
      cleaned.push(`${name}=${cleanedValue}`)
    } else {
      // 토큰 쿠키가 아니면 원본 유지 — 국제화된 값 등을 파괴하지 않는다
      cleaned.push(part)
    }
  }

  return {
    bearerToken,
    sanitizedCookieHeader: cleaned.join('; '),
  }
}

function buildCookieMatcher(authConfig: AuthConfig): (name: string) => boolean {
  if (authConfig.cookieName) {
    const target = authConfig.cookieName
    return (name) => name === target
  }
  if (authConfig.serviceName) {
    const prefix = `${authConfig.serviceName}_token`
    return (name) => name === prefix
  }
  // 폴백: 이름이 `_token`으로 끝나지만 refresh 토큰은 제외
  // (단독 `refresh_token`, `xxx_refresh_token` 모두 제외)
  return (name) => /_token$/.test(name) && !/(?:^|_)refresh_token$/.test(name)
}
