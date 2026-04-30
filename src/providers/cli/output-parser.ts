import YAML from 'yaml'
import type {OutputParserType} from '../../core/types.js'

export function parseOutput(stdout: string, parser: OutputParserType): unknown {
  switch (parser) {
    case 'json':
      try {
        return JSON.parse(stdout)
      } catch {
        return stdout.trim()
      }

    case 'line':
      return stdout.trim()

    case 'lines':
      return stdout.split('\n').filter(Boolean)

    case 'table':
      return parseTable(stdout)

    case 'csv':
      return parseCsv(stdout)

    case 'yaml':
      return YAML.parse(stdout)
  }
}

function parseTable(stdout: string): Record<string, string>[] {
  const lines = stdout.split('\n').filter(Boolean)
  if (lines.length === 0) return []

  const headers = lines[0].split(/\s+/).filter(Boolean)
  return lines.slice(1).map((line) => {
    const values = line.split(/\s+/).filter(Boolean)
    const row: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? ''
    }
    return row
  })
}

function parseCsv(stdout: string): Record<string, string>[] {
  const lines = stdout.split('\n').filter(Boolean)
  if (lines.length === 0) return []

  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim())
    const row: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? ''
    }
    return row
  })
}
