/**
 * HTTP/HTTPS proxy 환경변수 파싱 및 undici dispatcher 팩토리.
 *
 * 기업 네트워크의 forward proxy 환경에서 native fetch 가 자동으로 우회를 인식하지
 * 못하기 때문에, 표준 환경변수(HTTPS_PROXY/HTTP_PROXY/NO_PROXY)를 명시적으로
 * 해석해 undici ProxyAgent 를 dispatcher 로 주입한다.
 *
 * 환경변수 동작 규칙(curl/관용 규칙 준수):
 *   - 대소문자 모두 인식. lowercase 값이 존재하면 lowercase 가 우선한다.
 *   - target URL 이 `https:` 이면 HTTPS_PROXY 만 사용 (HTTP_PROXY 로 폴백하지 않음).
 *   - target URL 이 `http:`  이면 HTTP_PROXY 만 사용.
 *   - NO_PROXY 가 일치하면 어떤 proxy 도 사용하지 않는다(=null 반환).
 *
 * NO_PROXY 매칭:
 *   - 콤마/공백 구분 패턴 리스트.
 *   - `*` 단독 → 모든 호스트 bypass.
 *   - `.example.com` → suffix 매칭 (sub.example.com 까지 포함, example.com 자체도 포함).
 *   - `example.com`  → 정확히 일치하는 호스트 + 모든 하위 도메인 (curl 호환).
 *   - `host:port`    → 호스트 + 포트가 모두 일치할 때만 (port 가 없으면 호스트만 비교).
 *   - localhost / 127.0.0.1 등은 단순 호스트 매칭으로 처리.
 *
 * 사용 예 (HTTP provider 통합 시):
 *   const config = readProxyEnv()
 *   const dispatcher = await createDispatcher(url, config)
 *   const res = await fetch(url, dispatcher ? {dispatcher} : {})
 */

export interface ProxyConfig {
  httpProxy?: string
  httpsProxy?: string
  noProxy?: string[]
}

/**
 * env 객체에서 lowercase / uppercase 둘 다 살피되 lowercase 가 우선이다.
 * 빈 문자열은 미설정으로 취급한다 (`HTTPS_PROXY=` 으로 명시적 비활성화하는 케이스).
 */
function pickEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const v = env[name]
    if (v !== undefined && v.length > 0) return v
  }
  return undefined
}

/**
 * NO_PROXY 문자열을 패턴 배열로 정규화한다.
 *   - 콤마와 공백 모두 구분자로 인식.
 *   - 양쪽 공백 제거, 빈 토큰 제거.
 *   - 호스트 비교는 case-insensitive 이므로 lowercase 로 normalize.
 */
function parseNoProxy(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const patterns = raw
    .split(/[\s,]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
  return patterns.length > 0 ? patterns : undefined
}

/**
 * 환경변수에서 ProxyConfig 를 읽는다.
 * env 인자가 없으면 process.env 를 사용한다.
 * 모든 키가 비어 있어도 빈 객체를 반환한다(호출자가 일관되게 다룰 수 있도록).
 */
export function readProxyEnv(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const httpsProxy = pickEnv(env, 'https_proxy', 'HTTPS_PROXY')
  const httpProxy = pickEnv(env, 'http_proxy', 'HTTP_PROXY')
  const noProxyRaw = pickEnv(env, 'no_proxy', 'NO_PROXY')

  const config: ProxyConfig = {}
  if (httpsProxy) config.httpsProxy = httpsProxy
  if (httpProxy) config.httpProxy = httpProxy
  const noProxy = parseNoProxy(noProxyRaw)
  if (noProxy) config.noProxy = noProxy
  return config
}

/**
 * 단일 NO_PROXY 패턴이 hostname/port 와 일치하는지 검사한다.
 *
 *   - '*'                : 항상 일치
 *   - '.example.com'     : example.com 또는 그 하위 도메인 (앞 점 매칭)
 *   - 'example.com'      : example.com 자체 + 모든 하위 도메인 (curl 호환)
 *   - 'host:port'        : host 부분 + port 모두 일치
 *
 * 이 함수는 한 패턴만 본다. 전체 NO_PROXY 처리는 shouldBypassProxy 가 담당.
 */
function matchNoProxyPattern(pattern: string, host: string, port: string): boolean {
  if (pattern === '*') return true

  // host:port 패턴 분리 (IPv6 대괄호 형태는 단순 케이스만 지원)
  let patternHost = pattern
  let patternPort: string | undefined
  const lastColon = pattern.lastIndexOf(':')
  // IPv6 처럼 콜론이 여러 개면 host:port 분리하지 않는다.
  if (lastColon > -1 && pattern.indexOf(':') === lastColon) {
    patternHost = pattern.slice(0, lastColon)
    patternPort = pattern.slice(lastColon + 1)
  }

  if (patternPort && patternPort !== port) return false

  // '.suffix' 매칭: sub.example.com, example.com 둘 다 포함
  if (patternHost.startsWith('.')) {
    const suffix = patternHost.slice(1)
    return host === suffix || host.endsWith('.' + suffix)
  }

  // 'plain' 매칭: 정확 일치 또는 하위 도메인
  return host === patternHost || host.endsWith('.' + patternHost)
}

/**
 * 대상 URL 이 NO_PROXY 패턴 중 하나라도 일치하면 true.
 * 잘못된 URL 이 들어오면 false (proxy 적용을 시도하도록).
 */
export function shouldBypassProxy(targetUrl: string, noProxy: string[]): boolean {
  if (!noProxy || noProxy.length === 0) return false
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  // URL.port 는 default port 일 때 빈 문자열을 준다. NO_PROXY 매칭에선 포트 없음으로 본다.
  const port = parsed.port

  for (const pattern of noProxy) {
    if (matchNoProxyPattern(pattern, host, port)) return true
  }
  return false
}

/**
 * 대상 URL 에 대해 사용해야 할 proxy URL 을 반환한다. 우회 또는 미설정이면 null.
 *
 *   - https URL → config.httpsProxy 만 사용 (없으면 null; HTTP_PROXY 로 폴백 안 함).
 *   - http  URL → config.httpProxy 만 사용 (없으면 null).
 *   - 스킴 불명/잘못된 URL → null.
 *
 * config 인자가 없으면 환경변수에서 읽어들인다.
 */
export function getProxyForUrl(targetUrl: string, config?: ProxyConfig): string | null {
  const cfg = config ?? readProxyEnv()

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return null
  }

  if (cfg.noProxy && shouldBypassProxy(targetUrl, cfg.noProxy)) {
    return null
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol === 'https:') {
    return cfg.httpsProxy ?? null
  }
  if (protocol === 'http:') {
    return cfg.httpProxy ?? null
  }
  return null
}

/**
 * 대상 URL 에 대해 undici ProxyAgent dispatcher 를 만든다.
 *
 *   - proxy 가 필요 없으면 undefined 를 반환한다 (fetch 가 default dispatcher 사용).
 *   - undici 가 설치되어 있지 않으면 undefined 와 함께 1회성 경고를 남긴다.
 *     (호출자는 native fetch 로 fallback 한다.)
 *
 * 반환 타입을 `unknown` 으로 둔 이유:
 *   undici 의 Dispatcher 타입을 직접 노출하면 union-cli 의 모든 fetch 호출 사이트가
 *   undici 타입에 결합된다. fetch 는 RequestInit 의 `dispatcher` 필드를 표준 타입으로
 *   노출하지 않으므로, 호출 측에서 어차피 cast 가 필요해 unknown 으로 통일한다.
 */
let undiciWarned = false
export async function createDispatcher(
  targetUrl: string,
  config?: ProxyConfig,
): Promise<unknown | undefined> {
  const proxyUrl = getProxyForUrl(targetUrl, config)
  if (!proxyUrl) return undefined

  try {
    // 동적 import: undici 가 deps 에 없는 환경에서도 모듈 로드는 실패하지 않도록.
    // spec 으로 package.json 에 'undici' 를 추가하기 전까지는 type 해결이 안 되므로,
    // 모듈 specifier 를 변수로 우회해 컴파일 타임 의존을 피한다 (런타임은 동일).
    const moduleId = 'undici'
    const undici = (await import(/* @vite-ignore */ moduleId)) as {
      ProxyAgent: new (uri: string) => unknown
    }
    return new undici.ProxyAgent(proxyUrl)
  } catch (err) {
    if (!undiciWarned) {
      undiciWarned = true
      const msg = err instanceof Error ? err.message : String(err)
      // logger 의존을 피하기 위해 stderr 직접 사용 (proxy-utils 는 standalone helper).
      process.stderr.write(
        `[proxy-utils] undici 모듈을 로드하지 못했습니다 (${msg}). ` +
          `proxy 설정이 적용되지 않습니다. 'npm install undici' 후 다시 시도하세요.\n`,
      )
    }
    return undefined
  }
}

/**
 * 테스트 전용: undici 경고 상태를 초기화한다 (반복 검증 시 사용).
 * @internal
 */
export function __resetUndiciWarning(): void {
  undiciWarned = false
}
