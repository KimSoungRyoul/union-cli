import {describe, it, expect, beforeEach} from 'vitest'
import {detectLang, setLang, setMessages, t} from '../src/core/i18n.js'

describe('detectLang', () => {
  it('UNION_CLI_LANG=ko 면 ko 반환', () => {
    expect(detectLang({UNION_CLI_LANG: 'ko'})).toBe('ko')
  })

  it('UNION_CLI_LANG=en 면 en 반환', () => {
    expect(detectLang({UNION_CLI_LANG: 'en'})).toBe('en')
  })

  it('UNION_CLI_LANG=ko_KR.UTF-8 도 ko 로 정규화', () => {
    expect(detectLang({UNION_CLI_LANG: 'ko_KR.UTF-8'})).toBe('ko')
  })

  it('UNION_CLI_LANG 미설정 + LANG=ko_KR → ko', () => {
    expect(detectLang({LANG: 'ko_KR.UTF-8'})).toBe('ko')
  })

  it('UNION_CLI_LANG 미설정 + LANG=en_US → en', () => {
    expect(detectLang({LANG: 'en_US.UTF-8'})).toBe('en')
  })

  it('LC_ALL 도 인식', () => {
    expect(detectLang({LC_ALL: 'ko_KR.UTF-8'})).toBe('ko')
  })

  it('아무 env 도 없으면 en (default)', () => {
    expect(detectLang({})).toBe('en')
  })

  it('지원하지 않는 언어 (ja) 는 en 으로 fallback', () => {
    expect(detectLang({UNION_CLI_LANG: 'ja'})).toBe('en')
  })
})

describe('t (translation)', () => {
  beforeEach(() => {
    // 각 테스트마다 default 로 reset (setLang 영향 isolation)
    setLang('en')
  })

  it('단순 키 조회 (ko)', () => {
    expect(t('plugin.list.empty', undefined, 'ko')).toBe('등록된 플러그인이 없습니다.')
  })

  it('단순 키 조회 (en)', () => {
    expect(t('plugin.list.empty', undefined, 'en')).toBe('No plugins registered.')
  })

  it('파라미터 치환 ({placeholder} → params)', () => {
    const msg = t('auth.login.success', {namespace: 'api'}, 'ko')
    expect(msg).toBe('api 인증 완료')
  })

  it('여러 파라미터 치환', () => {
    const msg = t('auth.login.failed', {namespace: 'api', reason: 'timeout'}, 'en')
    expect(msg).toBe('api authentication failed: timeout')
  })

  it('숫자 파라미터도 String() 으로 변환', () => {
    const msg = t('doctor.manifests.count', {count: 3}, 'ko')
    expect(msg).toBe('매니페스트: 3개')
  })

  it('파라미터 미제공 placeholder 는 그대로 유지', () => {
    const msg = t('auth.login.success', {}, 'ko')
    expect(msg).toBe('{namespace} 인증 완료')
  })

  it('ko 에 키 없으면 en fallback', () => {
    setMessages('en', {'fallback.test': 'fallback works'})
    // ko 에는 없음 (setMessages 가 en 에만 추가) → en fallback
    expect(t('fallback.test', undefined, 'ko')).toBe('fallback works')
  })

  it('어느 lang 에도 키가 없으면 key 자체 반환', () => {
    expect(t('does.not.exist', undefined, 'en')).toBe('does.not.exist')
  })

  it('setLang 후 명시적 lang 인자 없으면 그 언어 사용', () => {
    setLang('ko')
    expect(t('plugin.list.empty')).toBe('등록된 플러그인이 없습니다.')
    setLang('en')
    expect(t('plugin.list.empty')).toBe('No plugins registered.')
  })

  it('명시적 lang 인자가 setLang 보다 우선', () => {
    setLang('ko')
    expect(t('plugin.list.empty', undefined, 'en')).toBe('No plugins registered.')
  })
})

describe('setMessages', () => {
  it('새 키 추가', () => {
    setMessages('ko', {'custom.key': '커스텀'})
    expect(t('custom.key', undefined, 'ko')).toBe('커스텀')
  })

  it('기존 키 덮어쓰기', () => {
    setMessages('en', {'common.unknown': 'OVERRIDDEN'})
    expect(t('common.unknown', undefined, 'en')).toBe('OVERRIDDEN')
  })
})
