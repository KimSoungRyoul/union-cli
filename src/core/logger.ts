const isDebug = process.argv.includes('--debug') || process.env.DEBUG !== undefined
const isQuiet = process.argv.includes('--quiet') || process.argv.includes('-q')
const noColor = process.env.NO_COLOR !== undefined

export const logger = {
  warn(msg: string) {
    if (!isQuiet) {
      const prefix = noColor ? '[union-cli]' : '\x1b[33m[union-cli]\x1b[0m'
      console.error(`${prefix} ${msg}`)
    }
  },
  debug(msg: string) {
    if (isDebug) {
      const prefix = noColor ? '[union-cli:debug]' : '\x1b[2m[union-cli:debug]\x1b[0m'
      console.error(`${prefix} ${msg}`)
    }
  },
  error(msg: string) {
    const prefix = noColor ? '[union-cli:error]' : '\x1b[31m[union-cli:error]\x1b[0m'
    console.error(`${prefix} ${msg}`)
  },
}
