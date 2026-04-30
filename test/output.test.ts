import {describe, it, expect, vi, afterEach} from 'vitest'
import {OutputFormatter, shouldUseColor, plainSymbol} from '../src/core/output.js'

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
