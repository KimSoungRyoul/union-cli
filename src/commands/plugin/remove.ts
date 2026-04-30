import {Command, Args, Flags} from '@oclif/core'
import {execFile} from 'node:child_process'
import {existsSync, rmSync} from 'node:fs'
import {promisify} from 'node:util'
import {loadRegistry, saveRegistry, type NpmRunner} from './add.js'

const execFileP = promisify(execFile)

interface NpmUninstaller {
  uninstall(cwd: string, pkgName: string): Promise<void>
}

const defaultUninstaller: NpmUninstaller = {
  async uninstall(cwd: string, pkgName: string): Promise<void> {
    await execFileP('npm', ['uninstall', '--save', pkgName], {cwd, env: {...process.env}})
  },
}

function getUninstaller(): NpmUninstaller {
  // Reuse the same NpmRunner injection if present (tests can override either).
  const injected = (globalThis as Record<string, unknown>).__unionCliNpmRunner as
    | (NpmRunner & Partial<NpmUninstaller>)
    | undefined
  if (injected && typeof injected.uninstall === 'function') {
    return injected as unknown as NpmUninstaller
  }
  return defaultUninstaller
}

export default class PluginRemove extends Command {
  static override description = '등록된 플러그인 제거'

  static override examples = [
    '<%= config.bin %> plugin remove @team/foo-plugin',
    '<%= config.bin %> plugin remove ./my-plugin --purge',
  ]

  static override args = {
    name: Args.string({required: true, description: '플러그인 이름 또는 경로'}),
  }

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
    purge: Flags.boolean({description: '로컬 파일도 디스크에서 삭제 (file source 한정)'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(PluginRemove)
    const cliName = this.config.bin
    const registry = loadRegistry(cliName)

    const idx = registry.plugins.findIndex((p) => p.name === args.name)
    if (idx === -1) {
      this.error(`등록된 플러그인이 아닙니다: ${args.name}`)
    }

    const record = registry.plugins[idx]

    // npm uninstall for npm/git sources (best effort).
    if (record.source === 'npm' || record.source === 'git') {
      try {
        await getUninstaller().uninstall(process.cwd(), record.name)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.warn(`npm uninstall 실패 (계속 진행): ${msg}`)
      }
    } else if (record.source === 'file' && flags.purge) {
      // --purge: delete local files
      try {
        if (existsSync(record.name)) {
          rmSync(record.name, {recursive: true, force: true})
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.warn(`로컬 파일 삭제 실패 (계속 진행): ${msg}`)
      }
    }

    registry.plugins.splice(idx, 1)
    await saveRegistry(cliName, registry)

    if (flags.json) {
      this.log(JSON.stringify({action: 'remove', plugin: record}, null, 2))
      return
    }
    this.log(`✓ 플러그인 제거: ${record.name}`)
    if (record.source === 'file' && flags.purge) {
      this.log('  로컬 파일도 삭제했습니다.')
    }
  }
}
