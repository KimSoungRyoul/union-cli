import YAML from 'yaml'

/**
 * Detect whether color/emoji output should be suppressed.
 * Checks: --no-color flag, NO_COLOR env, TERM=dumb, FORCE_COLOR env.
 */
export function shouldUseColor(flags?: Record<string, unknown>): boolean {
  // FORCE_COLOR overrides everything
  if (process.env.FORCE_COLOR) return true
  if (flags?.['no-color']) return false
  if (process.env.NO_COLOR !== undefined) return false
  if (process.env.TERM === 'dumb') return false
  return process.stdout.isTTY ?? false
}

/**
 * Replace emoji/symbol with plain text when color is disabled.
 */
export function plainSymbol(emoji: string, fallback: string, useColor: boolean): string {
  return useColor ? emoji : fallback
}

export class OutputFormatter {
  readonly isTTY: boolean

  constructor() {
    this.isTTY = process.stdout.isTTY ?? false
  }

  format(data: unknown, format: string): string {
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2)

      case 'yaml':
        return YAML.stringify(data)

      case 'table':
        return this.formatTable(data)

      case 'csv':
        return this.formatCsv(data)

      case 'line':
      default:
        return String(data)
    }
  }

  print(data: unknown, options: {format: string; quiet: boolean; noColor: boolean}): void {
    if (options.quiet) return
    const output = this.format(data, options.format)
    console.log(output)
  }

  private formatTable(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
      return String(data)
    }

    const rows = data as Record<string, unknown>[]
    const keys = Object.keys(rows[0])

    // Calculate column widths (header vs. longest cell)
    const widths = keys.map((key) => {
      const maxCell = rows.reduce((max, row) => {
        const len = String(row[key] ?? '').length
        return len > max ? len : max
      }, 0)
      return Math.max(key.length, maxCell)
    })

    // Build header
    const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ')
    const separator = widths.map((w) => '-'.repeat(w)).join('  ')

    // Build body rows
    const body = rows.map((row) =>
      keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i])).join('  '),
    )

    return [header, separator, ...body].join('\n')
  }

  private formatCsv(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
      return String(data)
    }

    const rows = data as Record<string, unknown>[]
    const keys = Object.keys(rows[0])

    const header = keys.join(',')
    const body = rows.map((row) =>
      keys.map((k) => {
        const val = String(row[k] ?? '')
        // Escape values containing commas or quotes
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`
        }
        return val
      }).join(','),
    )

    return [header, ...body].join('\n')
  }
}
