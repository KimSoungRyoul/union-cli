import YAML from 'yaml'
import {writeWithPager, shouldUsePager} from './pager.js'

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

/** Options controlling whether ANSI escapes are emitted. */
export interface ColorOptions {
  /** Explicit override (e.g., --no-color flag). When true, color is disabled. */
  noColor?: boolean
  /** Override stdout TTY detection (defaults to process.stdout.isTTY). */
  isTty?: boolean
}

/**
 * Decide whether color should be applied for a given call.
 * All conditions must be satisfied:
 *   - NO_COLOR env not set
 *   - TERM != "dumb"
 *   - opts.noColor is not true
 *   - opts.isTty (or process.stdout.isTTY) is truthy
 * FORCE_COLOR overrides everything.
 */
function colorEnabled(opts?: ColorOptions): boolean {
  if (process.env.FORCE_COLOR) return true
  if (opts?.noColor) return false
  if (process.env.NO_COLOR !== undefined) return false
  if (process.env.TERM === 'dumb') return false
  const tty = opts?.isTty ?? process.stdout.isTTY
  return Boolean(tty)
}

/** Wrap text in an ANSI escape pair when color is enabled. */
export function colorize(text: string, code: string, opts?: ColorOptions): string {
  if (!colorEnabled(opts)) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

// Public color helpers (each respects ColorOptions / env detection)
export const red = (text: string, opts?: ColorOptions): string => colorize(text, '31', opts)
export const green = (text: string, opts?: ColorOptions): string => colorize(text, '32', opts)
export const yellow = (text: string, opts?: ColorOptions): string => colorize(text, '33', opts)
export const cyan = (text: string, opts?: ColorOptions): string => colorize(text, '36', opts)
export const dim = (text: string, opts?: ColorOptions): string => colorize(text, '2', opts)
export const bold = (text: string, opts?: ColorOptions): string => colorize(text, '1', opts)

/** Optional configuration for OutputFormatter color behaviour. */
export interface OutputFormatterOptions {
  /** Disable color output entirely. Default: auto-detect via env + isTty. */
  noColor?: boolean
  /** Override TTY detection (mainly for tests). Default: process.stdout.isTTY. */
  isTty?: boolean
}

export class OutputFormatter {
  readonly isTTY: boolean
  private readonly opts: OutputFormatterOptions

  constructor(opts: OutputFormatterOptions = {}) {
    this.opts = opts
    this.isTTY = opts.isTty ?? process.stdout.isTTY ?? false
  }

  /** Resolve effective color options for this formatter (per call override possible). */
  private colorOpts(override?: ColorOptions): ColorOptions {
    return {
      noColor: override?.noColor ?? this.opts.noColor,
      isTty: override?.isTty ?? this.opts.isTty ?? process.stdout.isTTY,
    }
  }

  format(data: unknown, format: string): string {
    switch (format) {
      case 'json':
        // Raw JSON — never colorize (machine-readable contract).
        return JSON.stringify(data, null, 2)

      case 'yaml':
        // Raw YAML — never colorize.
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

  /**
   * print() 의 비동기 변형. table/yaml/line/csv 형식이고 TTY + 긴 출력이면 pager 로 파이프.
   * JSON 형식은 raw stdout (machine-readable 보존, 파이프/리다이렉트 안전).
   * --no-pager / NO_PAGER / PAGER='' / non-TTY 시 자동으로 pager 비활성.
   */
  async printAsync(
    data: unknown,
    options: {format: string; quiet: boolean; noColor: boolean; pager?: boolean},
  ): Promise<void> {
    if (options.quiet) return
    const output = this.format(data, options.format)
    const pagerEnabled = options.pager !== false && options.format !== 'json'
    if (pagerEnabled && this.isTTY && shouldUsePager({enabled: true})) {
      await writeWithPager(output + '\n', {enabled: true})
      return
    }
    console.log(output)
  }

  /** Wrap an error message with red color when enabled. */
  error(text: string, override?: ColorOptions): string {
    return red(text, this.colorOpts(override))
  }

  /** Wrap a success message with green color when enabled. */
  success(text: string, override?: ColorOptions): string {
    return green(text, this.colorOpts(override))
  }

  /** Wrap a warning message with yellow color when enabled. */
  warning(text: string, override?: ColorOptions): string {
    return yellow(text, this.colorOpts(override))
  }

  private formatTable(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
      return String(data)
    }

    const rows = data as Record<string, unknown>[]
    const keys = Object.keys(rows[0])
    const colorOpts = this.colorOpts()

    // Calculate column widths (header vs. longest cell)
    const widths = keys.map((key) => {
      const maxCell = rows.reduce((max, row) => {
        const len = String(row[key] ?? '').length
        return len > max ? len : max
      }, 0)
      return Math.max(key.length, maxCell)
    })

    // Build header (bold when color enabled — padding stays on raw width).
    const header = keys
      .map((k, i) => bold(k.padEnd(widths[i]), colorOpts))
      .join('  ')
    const separator = widths.map((w) => '-'.repeat(w)).join('  ')

    // Build body rows. Apply semantic colors per common status columns
    // (status / state). Padding is computed on the raw value so alignment
    // is preserved when escapes are inserted.
    const body = rows.map((row) =>
      keys
        .map((k, i) => {
          const raw = String(row[k] ?? '').padEnd(widths[i])
          return this.colorizeCell(k, String(row[k] ?? ''), raw, colorOpts)
        })
        .join('  '),
    )

    return [header, separator, ...body].join('\n')
  }

  /**
   * Apply semantic color to a table cell when its column is a status column.
   * The padded string is what gets colorized so alignment is preserved.
   */
  private colorizeCell(
    key: string,
    rawValue: string,
    paddedValue: string,
    colorOpts: ColorOptions,
  ): string {
    const lcKey = key.toLowerCase()
    if (lcKey !== 'status' && lcKey !== 'state') return paddedValue

    const lc = rawValue.toLowerCase()
    if (lc === 'error' || lc === 'failed' || lc === 'fail') {
      return red(paddedValue, colorOpts)
    }
    if (lc === 'success' || lc === 'ok' || lc === 'active' || lc === 'ready') {
      return green(paddedValue, colorOpts)
    }
    if (lc === 'warning' || lc === 'warn' || lc === 'pending') {
      return yellow(paddedValue, colorOpts)
    }
    return paddedValue
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
