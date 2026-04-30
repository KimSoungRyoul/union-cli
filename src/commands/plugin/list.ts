import {Command, Flags} from '@oclif/core'
import {loadRegistry, type PluginRecord} from './add.js'

/** Compute display width treating CJK characters as width 2. */
function strWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    w += (cp >= 0x1100 && (cp <= 0x115F || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0x4E00 && cp <= 0x9FFF))) ? 2 : 1
  }
  return w
}

function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - strWidth(s)))
}

interface ListRow {
  name: string
  source: string
  manifests: string
  installed: string
}

export default class PluginList extends Command {
  static override description = '등록된 플러그인 목록'

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(PluginList)
    const registry = loadRegistry(this.config.bin)

    if (flags.json) {
      this.log(JSON.stringify({plugins: registry.plugins}, null, 2))
      return
    }

    if (registry.plugins.length === 0) {
      this.log('등록된 플러그인이 없습니다.')
      return
    }

    const rows: ListRow[] = registry.plugins.map((p: PluginRecord) => ({
      name: p.name,
      source: p.source,
      manifests: String(p.manifestPaths.length),
      installed: p.installedAt.replace('T', ' ').substring(0, 19),
    }))

    const headers = ['NAME', 'SOURCE', 'MANIFESTS', 'INSTALLED']
    const keys: (keyof ListRow)[] = ['name', 'source', 'manifests', 'installed']
    const widths = keys.map((k, i) =>
      Math.max(headers[i].length, ...rows.map((r) => strWidth(r[k]))),
    )

    this.log(headers.map((h, i) => padEnd(h, widths[i])).join('  '))
    this.log(widths.map((w) => '-'.repeat(w)).join('  '))
    for (const row of rows) {
      this.log(keys.map((k, i) => padEnd(row[k], widths[i])).join('  '))
    }
  }
}
