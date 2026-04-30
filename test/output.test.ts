import {describe, it, expect, vi, afterEach, beforeEach} from 'vitest'
import {
  OutputFormatter,
  shouldUseColor,
  plainSymbol,
  colorize,
  red,
  green,
  yellow,
  bold,
} from '../src/core/output.js'

const ESC = '\x1b'

describe('OutputFormatter', () => {
  const formatter = new OutputFormatter()

  describe('format — json', () => {
    it('객체를 JSON 문자열로 포맷한다', () => {
      const data = {name: 'test', value: 42}
      const result = formatter.format(data, 'json')
      expect(result).toBe(JSON.stringify(data, null, 2))
    })

    it('배열을 JSON 문자열로 포맷한다', () => {
      const data = [1, 2, 3]
      const result = formatter.format(data, 'json')
      expect(result).toBe(JSON.stringify(data, null, 2))
    })
  })

  describe('format — table', () => {
    it('객체 배열을 컬럼 정렬된 테이블로 포맷한다', () => {
      const data = [
        {name: 'Alice', age: 30},
        {name: 'Bob', age: 25},
      ]
      const result = formatter.format(data, 'table')
      const lines = result.split('\n')

      // Header
      expect(lines[0]).toMatch(/name\s+age/)
      // Separator
      expect(lines[1]).toMatch(/^-+\s+-+$/)
      // Data rows
      expect(lines[2]).toMatch(/Alice\s+30/)
      expect(lines[3]).toMatch(/Bob\s+25/)
    })

    it('빈 배열은 String으로 변환한다', () => {
      const result = formatter.format([], 'table')
      expect(result).toBe(String([]))
    })
  })

  describe('format — csv', () => {
    it('객체 배열을 CSV로 포맷한다', () => {
      const data = [
        {name: 'Alice', age: 30},
        {name: 'Bob', age: 25},
      ]
      const result = formatter.format(data, 'csv')
      const lines = result.split('\n')

      expect(lines[0]).toBe('name,age')
      expect(lines[1]).toBe('Alice,30')
      expect(lines[2]).toBe('Bob,25')
    })
  })

  describe('format — yaml', () => {
    it('객체를 YAML로 포맷한다', () => {
      const data = {name: 'test', value: 42}
      const result = formatter.format(data, 'yaml')
      expect(result).toContain('name: test')
      expect(result).toContain('value: 42')
    })
  })

  describe('format — line', () => {
    it('데이터를 String으로 변환한다', () => {
      expect(formatter.format(123, 'line')).toBe('123')
      expect(formatter.format('hello', 'line')).toBe('hello')
    })
  })

  describe('shouldUseColor', () => {
    const origEnv = {...process.env}
    afterEach(() => {
      process.env = {...origEnv}
    })

    it('FORCE_COLOR가 설정되면 항상 true', () => {
      process.env.FORCE_COLOR = '1'
      expect(shouldUseColor()).toBe(true)
    })

    it('--no-color 플래그가 전달되면 false', () => {
      delete process.env.NO_COLOR
      delete process.env.FORCE_COLOR
      expect(shouldUseColor({'no-color': true})).toBe(false)
    })

    it('NO_COLOR 환경변수가 설정되면 false', () => {
      delete process.env.FORCE_COLOR
      process.env.NO_COLOR = ''
      expect(shouldUseColor()).toBe(false)
    })

    it('TERM=dumb이면 false', () => {
      delete process.env.FORCE_COLOR
      delete process.env.NO_COLOR
      process.env.TERM = 'dumb'
      expect(shouldUseColor()).toBe(false)
    })
  })

  describe('plainSymbol', () => {
    it('useColor=true이면 이모지 반환', () => {
      expect(plainSymbol('✅', '[OK]', true)).toBe('✅')
    })

    it('useColor=false이면 fallback 반환', () => {
      expect(plainSymbol('✅', '[OK]', false)).toBe('[OK]')
    })
  })

  describe('print', () => {
    it('quiet 모드에서는 출력하지 않는다', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      formatter.print({data: 'test'}, {format: 'json', quiet: true, noColor: false})
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it('quiet가 아니면 포맷 후 출력한다', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      formatter.print({a: 1}, {format: 'json', quiet: false, noColor: false})
      expect(spy).toHaveBeenCalledWith(JSON.stringify({a: 1}, null, 2))
      spy.mockRestore()
    })
  })
})

describe('OutputFormatter — ANSI color support', () => {
  const origEnv = {...process.env}

  beforeEach(() => {
    // Start each test from a clean env so detection logic is deterministic.
    delete process.env.NO_COLOR
    delete process.env.FORCE_COLOR
    process.env.TERM = 'xterm-256color'
  })

  afterEach(() => {
    process.env = {...origEnv}
  })

  // ─── Case A — TTY + error → red ANSI ─────────────────────────────
  it('case A: TTY 환경에서 error()는 빨간색 ANSI 코드를 포함한다', () => {
    const fmt = new OutputFormatter({isTty: true})
    const out = fmt.error('boom')
    expect(out).toContain(`${ESC}[31m`)
    expect(out).toContain('boom')
    expect(out).toContain(`${ESC}[0m`)
  })

  // ─── Case B — non-TTY → plain text ───────────────────────────────
  it('case B: non-TTY 환경에서는 색상이 적용되지 않는다', () => {
    const fmt = new OutputFormatter({isTty: false})
    expect(fmt.error('boom')).toBe('boom')
    expect(fmt.success('ok')).toBe('ok')
    expect(fmt.warning('hmm')).toBe('hmm')
  })

  // ─── Case C — NO_COLOR env → plain text even on TTY ─────────────
  it('case C: NO_COLOR 환경변수가 있으면 TTY여도 색상 미적용', () => {
    process.env.NO_COLOR = '1'
    const fmt = new OutputFormatter({isTty: true})
    expect(fmt.error('boom')).toBe('boom')
    expect(red('x', {isTty: true})).toBe('x')
  })

  // ─── Case D — TERM=dumb → plain text ─────────────────────────────
  it('case D: TERM=dumb 이면 색상 미적용', () => {
    process.env.TERM = 'dumb'
    const fmt = new OutputFormatter({isTty: true})
    expect(fmt.success('ok')).toBe('ok')
  })

  // ─── Case E — opts.noColor=true → plain text ─────────────────────
  it('case E: opts.noColor=true 이면 TTY여도 색상 미적용', () => {
    const fmt = new OutputFormatter({isTty: true, noColor: true})
    expect(fmt.error('boom')).toBe('boom')
    // colorize() 직접 호출도 동일
    expect(colorize('x', '31', {isTty: true, noColor: true})).toBe('x')
  })

  // ─── Case F — table + TTY → header is bold ───────────────────────
  it('case F: table 형식 + TTY 환경에서 헤더가 bold(\\x1b[1m) 로 출력된다', () => {
    const fmt = new OutputFormatter({isTty: true})
    const out = fmt.format(
      [
        {name: 'Alice', age: 30},
        {name: 'Bob', age: 25},
      ],
      'table',
    )
    const headerLine = out.split('\n')[0]
    expect(headerLine).toContain(`${ESC}[1m`)
    expect(headerLine).toContain('name')
    expect(headerLine).toContain('age')
    // Reset code present
    expect(headerLine).toContain(`${ESC}[0m`)
  })

  // ─── Case G — JSON + TTY → still raw (no escapes) ────────────────
  it('case G: JSON 형식은 TTY 여도 raw 그대로 (색상 미적용)', () => {
    const fmt = new OutputFormatter({isTty: true})
    const data = {name: 'test', value: 42}
    const out = fmt.format(data, 'json')
    expect(out).toBe(JSON.stringify(data, null, 2))
    expect(out).not.toContain(ESC)
  })

  it('case G (YAML): YAML 형식도 TTY 여도 raw 그대로', () => {
    const fmt = new OutputFormatter({isTty: true})
    const out = fmt.format({k: 'v'}, 'yaml')
    expect(out).not.toContain(ESC)
  })

  // ─── Helper sanity ───────────────────────────────────────────────
  it('green/yellow/bold helper 도 동일한 활성화 조건을 따른다', () => {
    expect(green('ok', {isTty: true})).toContain(`${ESC}[32m`)
    expect(yellow('warn', {isTty: true})).toContain(`${ESC}[33m`)
    expect(bold('h', {isTty: true})).toContain(`${ESC}[1m`)
    // disabled
    expect(green('ok', {isTty: false})).toBe('ok')
  })

  // ─── Status column auto-color ────────────────────────────────────
  it('table status 컬럼: error=red, active=green, warning=yellow', () => {
    const fmt = new OutputFormatter({isTty: true})
    const out = fmt.format(
      [
        {name: 'a', status: 'error'},
        {name: 'b', status: 'active'},
        {name: 'c', status: 'warning'},
      ],
      'table',
    )
    expect(out).toContain(`${ESC}[31m`) // error → red
    expect(out).toContain(`${ESC}[32m`) // active → green
    expect(out).toContain(`${ESC}[33m`) // warning → yellow
  })

  // ─── FORCE_COLOR override ────────────────────────────────────────
  it('FORCE_COLOR 가 설정되면 non-TTY 에서도 색상 적용', () => {
    process.env.FORCE_COLOR = '1'
    const fmt = new OutputFormatter({isTty: false})
    expect(fmt.error('boom')).toContain(`${ESC}[31m`)
  })
})
