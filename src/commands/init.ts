import {Command, Flags} from '@oclif/core'
import {existsSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'

export default class Init extends Command {
  static override description = '프로젝트 초기화'

  static override flags = {
    force: Flags.boolean({char: 'f', description: '기존 설정 덮어쓰기'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    const projectDir = join(process.cwd(), '.union-cli')
    const pluginsDir = join(process.cwd(), 'plugins')
    if (existsSync(projectDir) && !flags.force) {
      this.log('이미 초기화되어 있습니다. --force로 덮어쓸 수 있습니다.')
      return
    }

    mkdirSync(projectDir, {recursive: true})
    mkdirSync(pluginsDir, {recursive: true})
    this.log('✓ 프로젝트 초기화 완료')
    this.log('다음 단계:')
    this.log('  1. plugins/ 디렉토리에 YAML manifest를 작성하세요')
    this.log(`  2. ${this.config.bin} build`)
  }
}
