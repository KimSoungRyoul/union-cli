/**
 * mTLS / private PKI 환경을 위한 TLS 옵션 helper.
 *
 * manifest 의 `provider.config.tls` 에 caFile/certFile/keyFile/rejectUnauthorized 를
 * 선언하면, undici Agent 의 connect 옵션으로 변환해 fetch 의 dispatcher 로 주입한다.
 *
 * proxy-utils 와 동일한 standalone 패턴 — http provider 통합은 별도 작업.
 *
 * 사용 예 (HTTP provider 통합 시):
 *   const cfg = readTlsConfig(this.config.tls)
 *   const dispatcher = await createTlsDispatcher(cfg)
 *   const res = await fetch(url, dispatcher ? {dispatcher} : {})
 */

import {readFileSync} from 'node:fs'

export interface TlsConfig {
  /** PEM 문자열 또는 파일 경로 배열. caFile 과 둘 중 하나만 사용 권장. */
  ca?: string | string[]
  /** CA 인증서 파일 경로. 단일 파일. */
  caFile?: string
  /** 클라이언트 인증서 PEM 문자열 */
  cert?: string
  /** 클라이언트 인증서 파일 경로 */
  certFile?: string
  /** 개인키 PEM 문자열 */
  key?: string
  /** 개인키 파일 경로 */
  keyFile?: string
  /** 자체 서명 인증서 허용 여부 (default true). 운영 환경에서 false 는 권장하지 않음. */
  rejectUnauthorized?: boolean
  /** SNI 호스트명 override */
  servername?: string
}

export interface LoadedTlsCertificates {
  ca?: string | string[]
  cert?: string
  key?: string
  rejectUnauthorized: boolean
  servername?: string
}

/**
 * raw 매니페스트 값에서 TlsConfig 를 추출. 빈 객체/undefined 면 null.
 */
export function readTlsConfig(rawTls: unknown): TlsConfig | null {
  if (rawTls === null || rawTls === undefined) return null
  if (typeof rawTls !== 'object') return null
  const r = rawTls as Record<string, unknown>
  const config: TlsConfig = {}
  if (typeof r.ca === 'string') config.ca = r.ca
  else if (Array.isArray(r.ca)) config.ca = r.ca.filter((v): v is string => typeof v === 'string')
  if (typeof r.caFile === 'string') config.caFile = r.caFile
  if (typeof r.cert === 'string') config.cert = r.cert
  if (typeof r.certFile === 'string') config.certFile = r.certFile
  if (typeof r.key === 'string') config.key = r.key
  if (typeof r.keyFile === 'string') config.keyFile = r.keyFile
  if (typeof r.rejectUnauthorized === 'boolean') config.rejectUnauthorized = r.rejectUnauthorized
  if (typeof r.servername === 'string') config.servername = r.servername
  // 모든 필드가 비어있으면 null 로 처리 (옵션 미사용)
  if (Object.keys(config).length === 0) return null
  return config
}

/**
 * config 의 *File 경로를 읽어 인증서/키 PEM 문자열로 로드한다.
 * 파일 미존재/읽기 실패 시 명확한 에러 throw.
 */
export function loadTlsCertificates(cfg: TlsConfig): LoadedTlsCertificates {
  const out: LoadedTlsCertificates = {
    rejectUnauthorized: cfg.rejectUnauthorized ?? true,
  }
  if (cfg.servername) out.servername = cfg.servername

  // CA: caFile (단일) + ca (PEM 또는 경로 배열) 모두 지원
  const caList: string[] = []
  if (cfg.caFile) {
    caList.push(readPemFile(cfg.caFile, 'caFile'))
  }
  if (typeof cfg.ca === 'string') {
    caList.push(cfg.ca)
  } else if (Array.isArray(cfg.ca)) {
    for (const item of cfg.ca) {
      // 휴리스틱: PEM 헤더 포함이면 그대로, 아니면 파일 경로로 간주.
      caList.push(item.includes('-----BEGIN') ? item : readPemFile(item, 'ca'))
    }
  }
  if (caList.length === 1) out.ca = caList[0]
  else if (caList.length > 1) out.ca = caList

  if (cfg.cert) out.cert = cfg.cert
  else if (cfg.certFile) out.cert = readPemFile(cfg.certFile, 'certFile')

  if (cfg.key) out.key = cfg.key
  else if (cfg.keyFile) out.key = readPemFile(cfg.keyFile, 'keyFile')

  return out
}

function readPemFile(path: string, fieldName: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    const reason = code === 'ENOENT' ? 'not found' : code === 'EACCES' ? 'permission denied' : (err as Error).message
    throw new Error(`tls.${fieldName}: failed to read "${path}" (${reason})`)
  }
}

let undiciWarned = false

/** test-only: warning 플래그 reset */
export function __resetUndiciWarning(): void {
  undiciWarned = false
}

/**
 * undici Agent 를 dispatcher 로 생성.
 *   - cfg null/undefined 또는 모든 필드 비어있으면 undefined (default fetch).
 *   - undici 미설치 → stderr 1회 경고 후 undefined (graceful fallback).
 *   - 파일 읽기 실패 시 throw (운영에서 명확한 에러 노출).
 */
export async function createTlsDispatcher(cfg: TlsConfig | null): Promise<unknown | undefined> {
  if (!cfg) return undefined
  const loaded = loadTlsCertificates(cfg)
  // 의미 있는 옵션이 하나도 없으면 default fetch (rejectUnauthorized: true 만 있을 때).
  const hasMaterial = loaded.ca !== undefined || loaded.cert !== undefined || loaded.key !== undefined
  const hasOverride = loaded.rejectUnauthorized === false || loaded.servername !== undefined
  if (!hasMaterial && !hasOverride) return undefined

  let undici: {Agent: new (opts: unknown) => unknown}
  try {
    const moduleName = 'undici'
    undici = (await import(moduleName)) as {Agent: new (opts: unknown) => unknown}
  } catch {
    if (!undiciWarned) {
      undiciWarned = true
      process.stderr.write(
        '[union-cli] undici 패키지가 설치되어 있지 않습니다. mTLS 옵션이 무시됩니다. ' +
          "'npm install undici' 후 다시 시도하세요.\n",
      )
    }
    return undefined
  }

  const connect: Record<string, unknown> = {rejectUnauthorized: loaded.rejectUnauthorized}
  if (loaded.ca !== undefined) connect.ca = loaded.ca
  if (loaded.cert !== undefined) connect.cert = loaded.cert
  if (loaded.key !== undefined) connect.key = loaded.key
  if (loaded.servername !== undefined) connect.servername = loaded.servername

  return new undici.Agent({connect})
}
